# Distributed Wagering Processor

Serviço financeiro distribuído para criação de wallets e processamento de operações de apostas recebidas por HTTP e AWS SQS. O projeto usa NestJS, Bun, PostgreSQL, MikroORM e LocalStack.

O enunciado original está em [CHALLENGE.md](./CHALLENGE.md). As decisões técnicas, garantias e limitações estão em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Pré-requisitos

- Bun 1.x
- Docker Desktop com Docker Compose
- Portas locais disponíveis para PostgreSQL, LocalStack e API

## 1. Instalação

```powershell
bun install
```

## 2. Configuração do ambiente

Copie o arquivo de exemplo:

```powershell
cp .env.example .env
```

Se a porta `5432` já estiver em uso, escolha outra em `POSTGRES_PORT` e atualize a mesma porta em `DATABASE_URL`.

## 3. Infraestrutura local

Inicie PostgreSQL e LocalStack:

```powershell
docker compose up -d
docker compose ps
```

Para investigar falhas de inicialização:

```powershell
docker compose logs postgres
docker compose logs localstack
```

As filas FIFO de entrada, DLQ e eventos são criadas pela aplicação quando `SQS_AUTO_CREATE_QUEUES=true`.

Falhas de processamento usam backoff exponencial por alteração da visibilidade da mensagem. Configure a progressão com `SQS_RETRY_BACKOFF_BASE_SECONDS` e `SQS_RETRY_BACKOFF_MAX_SECONDS`.

Referências pendentes são reprocessadas automaticamente pelo scheduler do NestJS. O worker pode ser controlado por `PENDING_REFERENCE_REPROCESSING_ENABLED`, `PENDING_REFERENCE_POLLING_INTERVAL_MS` e `PENDING_REFERENCE_BATCH_SIZE`.

## 4. Banco de dados

Aplique as migrations:

```powershell
bun run migration:up
bun run migration:list
```

Outros comandos disponíveis:

```powershell
bun run migration:create -- --name=nome-da-migration
bun run migration:down
```

## 5. Execução

Modo de desenvolvimento:

```powershell
bun run start:dev
```

A API usa `http://localhost:3000` por padrão.

## 6. Testes e verificação

Execute toda a suíte:

```powershell
bun test
```

Comandos específicos:

```powershell
bun run test:unit
bun run test:integration
```

Os testes de integração usam `TEST_DATABASE_URL` quando definido; caso contrário, usam `DATABASE_URL`. Cada arquivo cria um schema isolado e o remove ao finalizar.

A suíte de persistência também parte de um schema vazio e executa as migrations reais, validando tabelas, índices e constraints, além dos fluxos de rollback e reaplicação.

## 7. API HTTP

### Criar wallet

```powershell
curl.exe -X POST http://localhost:3000/wallets `
  -H "Content-Type: application/json" `
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Saldo inicial positivo cria, na mesma transação, a wallet, uma transação interna `OPENING`, um lançamento `CREDIT` e mensagens na Outbox.

### Consultar wallet e ledger

```text
GET /wallets/:walletId
GET /wallets/:walletId/ledger?cursor=&limit=50
POST /wallets/:walletId/reconciliation
```

### Enviar operação de aposta

```powershell
curl.exe -X POST http://localhost:3000/wagering/transactions `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: provider-a:bet-1" `
  -H "X-Correlation-Id: request-1" `
  -d '{"providerId":"provider-a","externalTransactionId":"bet-1","playerId":"PLAYER_UUID","walletId":"WALLET_UUID","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Operações aceitas: `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. `REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId`. `OPENING` é exclusivamente interno.

Consultas disponíveis:

```text
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

### Health checks

```text
GET /health/live
GET /health/ready
```

`ready` verifica PostgreSQL e SQS.

### Métricas

```text
GET /metrics
```

## 8. Estrutura principal

```text
src/
├── domain/          regras, entidades, value objects e eventos
├── application/     casos de uso
├── infrastructure/  PostgreSQL, MikroORM, SQS e observabilidade
└── interfaces/http/ controllers e DTOs

test/
├── unit/            testes unitários
└── integration/     testes de integrações
```

## 9. Estado e limitações conhecidas

- A autenticação não foi implementada; a decisão e o ponto de evolução estão documentados em `ARCHITECTURE.md`.
- A suíte cobre PostgreSQL, LocalStack, múltiplos processos, crash antes do ack, recuperação após reinício e valida automaticamente, ao final de cada cenário financeiro de aplicação e mensageria, que `wallet.balance` corresponde ao saldo reconstruído pelo ledger.

## 10. Encerramento do ambiente

Para parar os containers sem apagar os volumes:

```powershell
docker compose down
```

Para também remover os dados locais:

```powershell
docker compose down --volumes
```
