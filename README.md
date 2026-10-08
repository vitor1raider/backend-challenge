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
Copy-Item .env.example .env
```

Use valores locais equivalentes a:

```env
POSTGRES_DB=backend_challenge
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/backend_challenge

LOCALSTACK_AUTH_TOKEN=adicione_se_necessario
LOCALSTACK_PORT=4566

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT=http://localhost:4566
SQS_AUTO_CREATE_QUEUES=true
SQS_WAGER_QUEUE_NAME=wager-transactions.fifo
SQS_WAGER_DLQ_NAME=wager-transactions-dlq.fifo
SQS_EVENTS_QUEUE_NAME=integration-events.fifo
SQS_VISIBILITY_TIMEOUT_SECONDS=60
SQS_MAX_RECEIVE_COUNT=5
SQS_WAIT_TIME_SECONDS=20
OUTBOX_POLLING_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=50

PORT=3000
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

## 4. Banco de dados

Confira a configuração do MikroORM:

```powershell
bunx --bun mikro-orm debug
```

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

Execução sem watch:

```powershell
bun src/main.ts
```

A API usa `http://localhost:3000` por padrão.

## 6. Testes e verificação

Execute a compilação TypeScript:

```powershell
node node_modules/typescript/bin/tsc --noEmit
```

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

## 8. Estrutura principal

```text
src/
├── domain/          regras, entidades, value objects e eventos
├── application/     casos de uso
├── infrastructure/  PostgreSQL, MikroORM, SQS e observabilidade
└── interfaces/http/ controllers e DTOs

test/
├── unit/
└── integration/
```

## 9. Estado e limitações conhecidas

- A autenticação não foi implementada; a decisão e o ponto de evolução estão documentados em `ARCHITECTURE.md`.
- O caso de uso de reprocessamento de referências pendentes existe, mas ainda precisa ser ligado a um scheduler.
- Logs JSON e health checks existem; métricas Prometheus ainda precisam ser expostas.
- A suíte possui integração real com PostgreSQL, mas ainda não cobre todos os cenários obrigatórios com LocalStack e múltiplos processos.
- A migration precisa acompanhar qualquer mudança posterior feita nas entities e nos índices.

## 10. Encerramento do ambiente

Para parar os containers sem apagar os volumes:

```powershell
docker compose down
```

Para também remover os dados locais:

```powershell
docker compose down --volumes
```
