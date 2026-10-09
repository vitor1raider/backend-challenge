import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

export const SQS_CLIENT = Symbol('SQS_CLIENT');
export const SQS_CONFIG = Symbol('SQS_CONFIG');

export interface SqsConfig {
  readonly autoCreateQueues: boolean;
  readonly wagerQueueName: string;
  readonly wagerDlqName: string;
  readonly eventsQueueName: string;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly retryBackoffBaseSeconds: number;
  readonly retryBackoffMaxSeconds: number;
  readonly maxReceiveCount: number;
  readonly outboxPollingIntervalMs: number;
  readonly outboxBatchSize: number;
}

export function createSqsConfig(): SqsConfig {
  return {
    autoCreateQueues: process.env.SQS_AUTO_CREATE_QUEUES !== 'false',
    wagerQueueName: process.env.SQS_WAGER_QUEUE_NAME ?? 'wager-transactions.fifo',
    wagerDlqName: process.env.SQS_WAGER_DLQ_NAME ?? 'wager-transactions-dlq.fifo',
    eventsQueueName: process.env.SQS_EVENTS_QUEUE_NAME ?? 'integration-events.fifo',
    waitTimeSeconds: readInteger('SQS_WAIT_TIME_SECONDS', 20, 0),
    visibilityTimeoutSeconds: readInteger(
      'SQS_VISIBILITY_TIMEOUT_SECONDS',
      60,
      0,
    ),
    retryBackoffBaseSeconds: readInteger(
      'SQS_RETRY_BACKOFF_BASE_SECONDS',
      5,
      1,
    ),
    retryBackoffMaxSeconds: readInteger(
      'SQS_RETRY_BACKOFF_MAX_SECONDS',
      300,
      1,
    ),
    maxReceiveCount: readInteger('SQS_MAX_RECEIVE_COUNT', 5, 1),
    outboxPollingIntervalMs: readInteger('OUTBOX_POLLING_INTERVAL_MS', 1_000, 1),
    outboxBatchSize: readInteger('OUTBOX_BATCH_SIZE', 50, 1),
  };
}

export interface SqsClientOptions {
  readonly region: string;
  readonly endpoint: string;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

export function createSqsClient(
  options: SqsClientOptions = {
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  },
): SQSClient {
  return new SQSClient(options);
}

@Injectable()
export class SqsInfrastructure implements OnModuleInit {
  private wagerQueueUrl: string | undefined;
  private eventsQueueUrl: string | undefined;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(SQS_CONFIG) private readonly config: SqsConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.autoCreateQueues) await this.ensureQueues();

    [this.wagerQueueUrl, this.eventsQueueUrl] = await Promise.all([
      this.lookupQueueUrl(this.config.wagerQueueName),
      this.lookupQueueUrl(this.config.eventsQueueName),
    ]);
  }

  get wagerTransactionsUrl(): string {
    return this.requireUrl(this.wagerQueueUrl, this.config.wagerQueueName);
  }

  get integrationEventsUrl(): string {
    return this.requireUrl(this.eventsQueueUrl, this.config.eventsQueueName);
  }

  private async ensureQueues(): Promise<void> {
    const fifoAttributes = {
      FifoQueue: 'true',
      ContentBasedDeduplication: 'false',
    };
    const dlqUrl = await this.ensureQueue(
      this.config.wagerDlqName,
      fifoAttributes,
    );
    const dlqArn = await this.queueArn(dlqUrl);

    await this.ensureQueue(this.config.wagerQueueName, {
      ...fifoAttributes,
      ReceiveMessageWaitTimeSeconds: String(this.config.waitTimeSeconds),
      VisibilityTimeout: String(this.config.visibilityTimeoutSeconds),
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: String(this.config.maxReceiveCount),
      }),
    });
    await this.ensureQueue(this.config.eventsQueueName, {
      ...fifoAttributes,
      ReceiveMessageWaitTimeSeconds: String(this.config.waitTimeSeconds),
      VisibilityTimeout: String(this.config.visibilityTimeoutSeconds),
    });
  }

  private async ensureQueue(
    name: string,
    attributes: Record<string, string>,
  ): Promise<string> {
    let url: string;
    try {
      url = await this.lookupQueueUrl(name);
    } catch (error) {
      if (!isMissingQueue(error)) throw error;
      const result = await this.client.send(
        new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
      );
      url = result.QueueUrl ?? (await this.lookupQueueUrl(name));
    }

    await this.client.send(
      new SetQueueAttributesCommand({
        QueueUrl: url,
        Attributes: Object.fromEntries(
          Object.entries(attributes).filter(([key]) => key !== 'FifoQueue'),
        ),
      }),
    );
    return url;
  }

  private async lookupQueueUrl(name: string): Promise<string> {
    const result = await this.client.send(
      new GetQueueUrlCommand({ QueueName: name }),
    );
    if (result.QueueUrl === undefined) throw new Error(`A fila SQS ${name} não possui URL`);
    return result.QueueUrl;
  }

  private async queueArn(url: string): Promise<string> {
    const result = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['QueueArn'],
      }),
    );
    const arn = result.Attributes?.QueueArn;
    if (arn === undefined) throw new Error(`A fila SQS ${url} não possui ARN`);
    return arn;
  }

  private requireUrl(url: string | undefined, name: string): string {
    if (url === undefined) throw new Error(`A fila SQS ${name} não foi inicializada`);
    return url;
  }
}

function readInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} deve ser um número inteiro maior ou igual a ${minimum}`);
  }
  return value;
}

function isMissingQueue(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'QueueDoesNotExist' ||
      error.name === 'AWS.SimpleQueueService.NonExistentQueue')
  );
}
