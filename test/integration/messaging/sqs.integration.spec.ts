import {
  DeleteQueueCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../../src/application/wagering/process-wager-transaction.use-case';
import { OutboxMessage } from '../../../src/domain/outbox/outbox-message';
import { WagerTransactionKind } from '../../../src/domain/enums';
import { Observability } from '../../../src/infrastructure/observability/observability';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';
import { MikroOutboxRepository } from '../../../src/infrastructure/persistence/repositories/mikro-outbox.repository';
import { SqsConsumer } from '../../../src/infrastructure/messaging/sqs/sqs-consumer';
import { SqsInfrastructure, type SqsConfig } from '../../../src/infrastructure/messaging/sqs/sqs-infrastructure';
import { SqsOutboxPublisher } from '../../../src/infrastructure/messaging/sqs/sqs-outbox.publisher';
import { WagerTransactionMessageHandler } from '../../../src/infrastructure/messaging/sqs/wager-transaction-message.handler';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const sqsEndpoint = process.env.SQS_ENDPOINT;
const enabled = Boolean(databaseUrl?.trim() && sqsEndpoint?.trim());
const it = enabled ? test : test.skip;
const suffix = `${process.pid}-${Date.now()}`;
const schema = `messaging_test_${process.pid}_${Date.now()}`;
const config: SqsConfig = {
  autoCreateQueues: true,
  wagerQueueName: `wager-${suffix}.fifo`,
  wagerDlqName: `wager-dlq-${suffix}.fifo`,
  eventsQueueName: `events-${suffix}.fifo`,
  waitTimeSeconds: 1,
  visibilityTimeoutSeconds: 1,
  maxReceiveCount: 2,
  outboxPollingIntervalMs: 10,
  outboxBatchSize: 100,
};

let orm: MikroORM;
let client: SQSClient;
let infrastructure: SqsInfrastructure;
let wagerDlqUrl: string;

describe('SQS and transactional outbox integration (LocalStack)', () => {
  beforeAll(async () => {
    if (!enabled) return;

    orm = await MikroORM.init({
      clientUrl: databaseUrl!,
      schema,
      entities: [
        WalletEntity,
        WalletLedgerEntryEntity,
        WagerTransactionEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
    });
    await orm.em.getConnection().execute(`create schema if not exists "${schema}"`);
    await orm.schema.create();

    client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint: sqsEndpoint!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    infrastructure = new SqsInfrastructure(client, config);
    await infrastructure.onModuleInit();
    wagerDlqUrl = (await client.send(new GetQueueUrlCommand({
      QueueName: config.wagerDlqName,
    }))).QueueUrl!;
  });

  beforeEach(async () => {
    if (!enabled) return;
    await orm.em.getConnection().execute(
      `truncate table "${schema}"."wallet_ledger_entries", "${schema}"."wager_transactions", "${schema}"."inbox_messages", "${schema}"."outbox_messages", "${schema}"."wallets" restart identity cascade`,
    );
    await Promise.all([
      client.send(new PurgeQueueCommand({ QueueUrl: infrastructure.wagerTransactionsUrl })),
      client.send(new PurgeQueueCommand({ QueueUrl: wagerDlqUrl })),
      client.send(new PurgeQueueCommand({ QueueUrl: infrastructure.integrationEventsUrl })),
    ]);
  });

  afterAll(async () => {
    if (!enabled) return;
    await Promise.allSettled([
      client.send(new DeleteQueueCommand({ QueueUrl: infrastructure.wagerTransactionsUrl })),
      client.send(new DeleteQueueCommand({ QueueUrl: wagerDlqUrl })),
      client.send(new DeleteQueueCommand({ QueueUrl: infrastructure.integrationEventsUrl })),
    ]);
    await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`);
    await orm.close(true);
    client.destroy();
  });

  it('deduplicates a redelivered wager through the persistent inbox', async () => {
    const playerId = randomUUID();
    const wallet = await new CreateWalletUseCase(orm.em).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: randomUUID(),
    });
    const envelope = {
      messageId: 'redelivered-message',
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId: 'redelivered-bet',
        idempotencyKey: 'provider-a:redelivered-bet',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '10.00', currency: 'BRL' },
      },
    } as const;

    await client.send(new SendMessageCommand({
      QueueUrl: infrastructure.wagerTransactionsUrl,
      MessageBody: JSON.stringify(envelope),
      MessageGroupId: wallet.id,
      MessageDeduplicationId: 'delivery-1',
    }));
    const handler = new WagerTransactionMessageHandler(
      new ProcessWagerTransactionUseCase(orm.em),
    );
    const consumer = new SqsConsumer(client, handler, {
      queueUrl: infrastructure.wagerTransactionsUrl,
      waitTimeSeconds: 1,
      visibilityTimeoutSeconds: 1,
    }, new Observability());

    expect(await consumer.pollOnce()).toBe(1);

    await client.send(new SendMessageCommand({
      QueueUrl: infrastructure.wagerTransactionsUrl,
      MessageBody: JSON.stringify(envelope),
      MessageGroupId: wallet.id,
      MessageDeduplicationId: 'delivery-2',
    }));
    expect(await consumer.pollOnce()).toBe(1);

    expect(await orm.em.fork().count(InboxMessageEntity, {})).toBe(1);
    expect(await orm.em.fork().count(WagerTransactionEntity, {
      externalTransactionId: 'redelivered-bet',
    })).toBe(1);
    expect(await orm.em.fork().count(WalletLedgerEntryEntity, {
      walletId: wallet.id,
    })).toBe(2);
    expect((await orm.em.fork().findOneOrFail(WalletEntity, {
      id: wallet.id,
    })).balance).toBe('90.00');
  });

  it('publishes each outbox event once with two concurrent publishers', async () => {
    const repository = new MikroOutboxRepository(orm.em.fork());
    for (let index = 0; index < 20; index += 1) {
      const id = randomUUID();
      await repository.save(OutboxMessage.rehydrate({
        id,
        aggregateId: randomUUID(),
        eventType: 'ConcurrentPublisherTest',
        payload: { eventId: id, index },
        occurredAt: new Date(Date.now() + index),
        attempts: 0,
        nextAttemptAt: undefined,
        publishedAt: undefined,
      }));
    }

    const observability = new Observability();
    const first = new SqsOutboxPublisher(
      orm.em,
      client,
      config,
      infrastructure,
      observability,
    );
    const second = new SqsOutboxPublisher(
      orm.em,
      client,
      config,
      infrastructure,
      observability,
    );
    const results = await Promise.all([first.runOnce(), second.runOnce()]);
    const rows = await orm.em.fork().find(OutboxMessageEntity, {});

    expect(results.reduce((sum, result) => sum + result.published, 0)).toBe(20);
    expect(rows).toHaveLength(20);
    expect(rows.every(({ publishedAt }) => publishedAt !== null)).toBe(true);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(20);
  });

  it('moves a permanently invalid message to the DLQ after the receive limit', async () => {
    await client.send(new SendMessageCommand({
      QueueUrl: infrastructure.wagerTransactionsUrl,
      MessageBody: '{invalid-json',
      MessageGroupId: 'invalid-messages',
      MessageDeduplicationId: randomUUID(),
    }));
    const consumer = new SqsConsumer(
      client,
      new WagerTransactionMessageHandler(
        new ProcessWagerTransactionUseCase(orm.em),
      ),
      {
        queueUrl: infrastructure.wagerTransactionsUrl,
        waitTimeSeconds: 1,
        visibilityTimeoutSeconds: 1,
      },
      new Observability(),
    );

    expect(await consumer.pollOnce()).toBe(1);
    await delay(1_100);
    expect(await consumer.pollOnce()).toBe(1);
    await delay(1_100);
    await consumer.pollOnce();

    const dlq = await client.send(new ReceiveMessageCommand({
      QueueUrl: wagerDlqUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
    }));

    expect(dlq.Messages).toHaveLength(1);
    expect(dlq.Messages?.[0]?.Body).toBe('{invalid-json');
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
