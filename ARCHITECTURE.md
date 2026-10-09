# Arquitetura — Distributed Wagering Processor

## 1. Objetivo

O serviço processa operações financeiras de apostas entregues por HTTP e AWS SQS sob semântica at-least-once. O desenho prioriza precisão monetária, idempotência persistente, consistência entre saldo e ledger, concorrência por wallet e publicação confiável de eventos.

As principais operações são `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`.

## 2. Stack e decisões principais

| Decisão | Escolha | Motivação |
|---|---|---|
| Runtime e testes | Bun | Stack obrigatória e execução rápida da suíte |
| Framework | NestJS | Composição modular, DI e integração HTTP |
| Persistência | PostgreSQL | Constraints, transações e locks compartilhados entre instâncias |
| ORM | MikroORM | Unit of Work, Identity Map, transações e locks explícitos |
| Dinheiro | `decimal.js` no domínio e `numeric(15,2)` no banco | Evitar erros de ponto flutuante |
| Mensageria | SQS FIFO via LocalStack | Entrada assíncrona, redelivery e DLQ locais |
| Entrega de eventos | Transactional Outbox | Impedir publicação antes do commit financeiro |
| Concorrência da wallet | Update condicionado por `version` com retry limitado | Evitar lost update sem lock global |

## 3. Organização em camadas

```text
src/
├── application/        # Casos de uso e coordenação dos fluxos
├── domain/             # Regras de negócio e modelos independentes de framework
├── infrastructure/     # Persistência, mensageria e observabilidade
└── interfaces/         # Controllers, DTOs e endpoints HTTP

test/
├── unit/               # Testes isolados de domínio, aplicação e interfaces
└── integration/        # PostgreSQL, LocalStack, migrations e concorrência real
```

## 4. Modelo financeiro

### Money

`Money` recebe e serializa `amount` como string decimal com exatamente duas casas. Operações usam `Decimal`, retornam novas instâncias e rejeitam moedas diferentes. O domínio não usa `number` para representar dinheiro.

Na persistência, valor e moeda ficam separados:

```text
amount   numeric(15,2)
currency varchar(3)
```

### Wallet

Uma wallet é identificada por UUID e existe no máximo uma vez para `(playerId, currency)`. Seu saldo nunca pode ser negativo. `version` começa em `1` e avança somente quando o saldo muda.

Débito e crédito retornam um `WalletLedgerEntry` já validado. Isso mantém a alteração de saldo e a criação do lançamento conectadas no modelo de domínio.

### Ledger

Cada lançamento contém valor, direção, saldo anterior e saldo posterior. A factory valida:

```text
CREDIT: balanceBefore + amount = balanceAfter
DEBIT:  balanceBefore - amount = balanceAfter
```

A constraint única `(walletId, transactionId)` limita cada transação financeira a um lançamento por wallet. `LOSS` e transações rejeitadas não geram lançamento.

### WagerTransaction

Estados persistidos:

```text
PENDING
PENDING_REFERENCE
PROCESSED
REJECTED
FAILED
```

`PROCESSED`, `REJECTED` e `FAILED` são terminais. O domínio controla as transições e armazena `failureCode`, referência interna, horário de processamento e saldo histórico observado.

## 5. Regras das operações

| Operação | Saldo | Ledger |
|---|---|---|
| `OPENING` | crédito interno | `CREDIT` |
| `BET` | débito | `DEBIT` |
| `WIN` | crédito | `CREDIT` |
| `LOSS` | sem alteração | nenhum |
| `REFUND` | crédito da BET referenciada | `CREDIT` |
| `ROLLBACK` | inverso da referência | entrada invertida |

Referências são resolvidas por `(providerId, referenceExternalTransactionId)`. O domínio valida provider, player, wallet, moeda, rodada, tipo e valor. Uma reversão que deixaria o saldo negativo recebe código diferente de uma aposta sem fundos.

## 6. Atomicidade

Os casos de uso financeiros executam dentro de `EntityManager.transactional()`. O objetivo do limite transacional é confirmar ou reverter conjuntamente:

```text
Inbox, quando aplicável
WagerTransaction
Wallet
WalletLedgerEntry
OutboxMessage(s)
```

Os repositories podem executar `flush`, mas, quando compartilham o `EntityManager` transacional do caso de uso, isso envia alterações ao banco sem confirmar a transação externa isoladamente.

## 7. Concorrência

A unidade de concorrência é a wallet. A atualização usa a condição:

```sql
where id = :walletId and version = :expectedVersion
```

Se nenhuma linha for alterada, o repository lança `WalletConcurrencyError`. O caso de uso repete a operação até três vezes, reabrindo a transação e recarregando o estado. Não existe lock global; wallets distintas podem progredir independentemente.

Consultas de Outbox e referências pendentes utilizam `FOR UPDATE SKIP LOCKED` por meio de `PESSIMISTIC_PARTIAL_WRITE`, permitindo competição entre workers sem selecionar a mesma linha simultaneamente.

## 8. Idempotência

O header `Idempotency-Key` é um hash SHA-256 é calculado sobre JSON canônico dos campos de negócio, com chaves ordenadas.

O fluxo é:

1. consultar a chave persistida;
2. se o hash divergir, retornar conflito;
3. se o hash coincidir, retornar transaction ID, status, failure code e saldo histórico originais;
4. se a chave não existir, processar e persistir a operação.

O banco mantém unicidade para `idempotencyKey` e para `(providerId, externalTransactionId)`. Mensagens SQS também são deduplicadas por Inbox usando a chave composta `(consumerName, messageId)`.

Em uma corrida de inserções com a mesma idempotency key, a violação de unicidade é interceptada e a operação persistida é recarregada. Payload idêntico é devolvido como replay; payload divergente continua sendo tratado como conflito.

## 9. Referências fora de ordem

Quando uma referência ainda não existe, a transação passa para `PENDING_REFERENCE`. O domínio agenda backoff exponencial a partir de 5 segundos, limitado a 1 hora, e usa TTL padrão de 24 horas.

Ao expirar, a transação é rejeitada com `REFERENCE_NOT_FOUND` e produz evento de rejeição. O caso de uso usa locks com `SKIP LOCKED` para múltiplos workers.

O `PendingReferenceScheduler`, registrado no scheduler do NestJS, executa o caso de uso periodicamente. O intervalo, o tamanho do lote e a habilitação são configurados por `PENDING_REFERENCE_POLLING_INTERVAL_MS`, `PENDING_REFERENCE_BATCH_SIZE` e `PENDING_REFERENCE_REPROCESSING_ENABLED`. Uma trava local impede sobreposição na mesma instância; entre instâncias, `SKIP LOCKED` coordena a seleção no PostgreSQL.

## 10. Inbox e consumo SQS

O consumidor usa long polling, processa mensagens com o mesmo caso de uso da API e só remove a mensagem após retorno bem-sucedido. Falhas não recebem ack. Antes de devolver a mensagem, o consumidor altera sua visibilidade com backoff exponencial calculado a partir de `ApproximateReceiveCount`, limitado pelas configurações `SQS_RETRY_BACKOFF_BASE_SECONDS` e `SQS_RETRY_BACKOFF_MAX_SECONDS`. A redrive policy move mensagens para DLQ depois do limite configurado.

No shutdown, novas consultas são interrompidas e o consumidor aguarda as mensagens em andamento. O Inbox participa da mesma transação financeira, permitindo redelivery sem repetir efeitos confirmados.

## 11. Transactional Outbox

Eventos são convertidos em `OutboxMessage` e persistidos antes do commit. O publisher consulta mensagens vencidas, publica no SQS FIFO e então marca `publishedAt`. Falhas incrementam `attempts` e definem `nextAttemptAt` com backoff exponencial.

O `eventId` é usado como `MessageDeduplicationId` e o aggregate como `MessageGroupId`. Se o processo morrer depois da aceitação pelo SQS e antes do commit de `publishedAt`, a publicação pode se repetir; essa janela é compatível com at-least-once e exige Inbox no consumidor.

Trade-off atual: o publisher mantém a transação e o lock enquanto chama o SQS. Isso simplifica o claim concorrente, mas aumenta o tempo de retenção do lock. Uma evolução seria persistir lease (`lockId`, `lockedUntil`) em uma transação curta e publicar fora dela.

## 12. Eventos

Eventos mínimos implementados:

- `WagerTransactionProcessed`, inclusive para `LOSS`;
- `WagerTransactionRejected`;
- `WagerTransactionPendingReference`;
- `WalletBalanceChanged`, apenas quando o saldo muda.

O envelope contém ID, tipo, versão, aggregate, correlação, causação, data ISO-8601 e payload JSON. Valores monetários são serializados como objetos com strings, nunca como instâncias de `Money`.

## 13. API e códigos HTTP

A API diferencia:

- `201`: operação criada/processada;
- `202`: referência pendente;
- `400`: payload ou header inválido;
- `404`: recurso não encontrado;
- `409`: conflito de unicidade ou idempotência;
- `422`: rejeição por regra de negócio;
- `503`: dependência indisponível no readiness.

## 14. Observabilidade

O NestJS usa logger JSON. A abstração `Observability` aceita correlation ID, message ID, transaction ID, wallet ID, provider ID, aggregate ID e metadados de retry sem registrar o payload financeiro completo.

Health checks separados:

- `/health/live` processo ativo;
- `/health/ready` PostgreSQL e SQS acessíveis.

Métricas Prometheus

- `/metrics` expõe as métricas da aplicação no formato de texto do Prometheus.

Métricas expostas:

| Métrica | Tipo | Labels | Finalidade |
|---|---|---|---|
| `wager_transactions_total` | Counter | `status` | Total de novas operações de aposta observado por status final; replays idempotentes não incrementam esse contador |
| `wager_idempotent_replays_total` | Counter | — | Total de requisições ou mensagens respondidas a partir de uma operação já persistida |
| `processing_retries_total` | Counter | `component` | Tentativas adicionais realizadas por `wallet`, `outbox`, `pending_reference` ou `sqs` |
| `sqs_dlq_messages_total` | Counter | — | Mensagens que alcançaram, durante o consumo, o limite configurado de recebimentos do SQS |
| `wallet_lock_conflicts_total` | Counter | — | Conflitos de concorrência otimista encontrados ao atualizar wallets |
| `outbox_lag_seconds` | Gauge | — | Idade, em segundos, da mensagem não publicada mais antiga da Outbox; vale zero quando não há mensagens pendentes |
| `wager_processing_duration_seconds` | Histogram | `status` | Duração do processamento de operações, inclusive falhas identificadas pelo status `ERROR` |

Os contadores e o histograma são atualizados pelo caso de uso de processamento, pelo consumidor SQS e pelo publisher da Outbox. O gauge de atraso é recalculado a cada execução do publisher. Como as métricas são mantidas em memória, seus valores são reiniciados quando a instância da aplicação é reiniciada.

O endpoint não consulta PostgreSQL nem SQS para responder. A disponibilidade das dependências continua sendo representada por `/health/ready`, enquanto `/metrics` fornece os sinais operacionais para coleta, alertas e dashboards.

## 15. Reconciliação

A reconciliação reconstrói o saldo a partir do ledger e o compara ao saldo materializado. Divergências não são corrigidas automaticamente; são devolvidas ao chamador e registradas em log estruturado.

## 16. Autenticação

Autenticação não foi implementada porque não pontua diretamente no desafio e o tempo foi priorizado para correção financeira. Em uma evolução, a identidade autenticada do provedor deve vir de um IdP OIDC e ser disponibilizada por uma porta como `ProviderIdentityPort`; o caso de uso deve comparar essa identidade com `providerId` em vez de confiar apenas no corpo.

Health checks permanecem públicos e mensagens da fila são consideradas canal interno, sem dispensar as validações do provider no domínio.

## 17. Testes

A suíte atual cobre:

- `Money`, wallet, ledger e operações de wager;
- conflitos de moeda e payload divergente;
- controllers e health checks;
- persistência real em PostgreSQL;
- execução real das migrations em schema vazio, incluindo validação de tabelas, índices e constraints, rollback e reaplicação;
- atomicidade de wallet, wager, ledger, Inbox e Outbox, incluindo falha injetada antes do commit e comprovação do rollback integral;
- replay com saldo histórico;
- duas apostas concorrentes disputando o mesmo saldo;
- cinquenta submissões paralelas da mesma operação com um único débito;
- wallets distintas processadas em paralelo;
- três processos Bun independentes disputando a mesma wallet no PostgreSQL;
- unicidade, rollback do ledger, Inbox e seleção da Outbox;
- SQS real via LocalStack, incluindo criação de filas FIFO, redelivery, retry transitório, limite de recebimentos e DLQ;
- deduplicação persistente da Inbox sem repetição do efeito financeiro;
- morte real de um worker depois do commit e antes do ack, seguida de redelivery para uma nova instância sem duplicação financeira;
- reinicialização do worker com recuperação e publicação da Outbox pendente, preservando a consistência final;
- dois publishers concorrentes selecionando a mesma Outbox;
- `REFUND` e `ROLLBACK` recebidos antes da transação referenciada e reprocessados posteriormente;
- reconciliação integrada em estado consistente e detecção de divergência entre saldo materializado e ledger;
- invariante compartilhada `wallet.balance == saldo reconstruído pelo ledger` executada após todos os cenários financeiros de aplicação e mensageria;
- métricas de processamento e retry nos fluxos integrados.
