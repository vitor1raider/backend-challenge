import {
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { ProcessWagerTransactionUseCase } from '../../../src/application/wagering/process-wager-transaction.use-case';
import { Observability } from '../../../src/infrastructure/observability/observability';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';
import { MikroUnitOfWork } from '../../../src/infrastructure/persistence/mikro-unit-of-work';
import { SqsConsumer } from '../../../src/infrastructure/messaging/sqs/sqs-consumer';
import type { SqsConfig } from '../../../src/infrastructure/messaging/sqs/sqs-infrastructure';
import { SqsOutboxPublisher } from '../../../src/infrastructure/messaging/sqs/sqs-outbox.publisher';
import { WagerTransactionMessageHandler } from '../../../src/infrastructure/messaging/sqs/wager-transaction-message.handler';

type WorkerMode =
  | 'commit-before-ack'
  | 'consume-once'
  | 'recover-once';

interface WorkerInput {
  readonly mode: WorkerMode;
  readonly databaseUrl: string;
  readonly schema: string;
  readonly sqsEndpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly wagerQueueUrl: string;
  readonly eventsQueueUrl: string;
  readonly config: SqsConfig;
}

const serializedInput = process.argv[2];
if (serializedInput === undefined) throw new Error('Worker input is required');
const input = JSON.parse(serializedInput) as WorkerInput;

const orm = await MikroORM.init({
  clientUrl: input.databaseUrl,
  schema: input.schema,
  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
});
const client = new SQSClient({
  region: input.region,
  endpoint: input.sqsEndpoint,
  credentials: {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
  },
});
const handler = new WagerTransactionMessageHandler(
  new ProcessWagerTransactionUseCase(new MikroUnitOfWork(orm.em)),
);

try {
  if (input.mode === 'commit-before-ack') {
    const response = await client.send(new ReceiveMessageCommand({
      QueueUrl: input.wagerQueueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
      VisibilityTimeout: input.config.visibilityTimeoutSeconds,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    const message = response.Messages?.[0];
    if (
      message?.MessageId === undefined ||
      message.ReceiptHandle === undefined ||
      message.Body === undefined
    ) throw new Error('Expected one complete SQS message');

    await handler.handle({
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
      body: message.Body,
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
    });
    process.stdout.write('COMMITTED\n');
    await new Promise(() => undefined);
  }

  const consumer = new SqsConsumer(
    client,
    handler,
    {
      queueUrl: input.wagerQueueUrl,
      waitTimeSeconds: input.config.waitTimeSeconds,
      visibilityTimeoutSeconds: input.config.visibilityTimeoutSeconds,
      retryBackoffBaseSeconds: input.config.retryBackoffBaseSeconds,
      retryBackoffMaxSeconds: input.config.retryBackoffMaxSeconds,
      maxReceiveCount: input.config.maxReceiveCount,
    },
    new Observability(),
  );
  const received = await consumer.pollOnce();

  if (input.mode === 'consume-once') {
    process.stdout.write(JSON.stringify({ received }));
  } else {
    const publisher = new SqsOutboxPublisher(
      orm.em,
      client,
      input.config,
      { integrationEventsUrl: input.eventsQueueUrl } as never,
      new Observability(),
    );
    const published = await publisher.runOnce();
    process.stdout.write(JSON.stringify({ received, published }));
  }
} finally {
  client.destroy();
  await orm.close(true);
}
