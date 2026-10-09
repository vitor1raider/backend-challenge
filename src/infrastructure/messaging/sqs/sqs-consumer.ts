import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  SQS_CLIENT,
  SQS_CONFIG,
  SqsInfrastructure,
  type SqsConfig,
} from './sqs-infrastructure';
import { WagerTransactionMessageHandler } from './wager-transaction-message.handler';
import { Observability } from '../../observability/observability';
import { MetricsService } from '../../observability/metrics.service';

export interface SqsReceivedMessage {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly body: string;
  readonly receiveCount: number;
}

export interface SqsMessageHandler {
  handle(message: SqsReceivedMessage): Promise<void>;
}

export interface SqsConsumerOptions {
  readonly queueUrl: string;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly retryBackoffBaseSeconds?: number;
  readonly retryBackoffMaxSeconds?: number;
  readonly maxReceiveCount?: number;
}

export class SqsConsumer {
  private abortController: AbortController | undefined;
  private readonly inFlight = new Set<Promise<void>>();
  private running: Promise<void> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly handler: SqsMessageHandler,
    private readonly options: SqsConsumerOptions,
    private readonly observability: Observability,
    private readonly metrics?: MetricsService,
  ) {}

  start(): void {
    if (this.running !== undefined) return;
    this.abortController = new AbortController();
    this.running = this.poll(this.abortController.signal).finally(() => {
      this.running = undefined;
      this.abortController = undefined;
    });
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    await this.running;
    await Promise.allSettled(this.inFlight);
  }

  async pollOnce(): Promise<number> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: this.options.waitTimeSeconds,
        VisibilityTimeout: this.options.visibilityTimeoutSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
      { abortSignal: AbortSignal.timeout(5_000) },
    );

    const messages = response.Messages ?? [];
    for (const message of messages) {
      const processing = this.process(message).finally(() => {
        this.inFlight.delete(processing);
      });
      this.inFlight.add(processing);
    }
    await Promise.allSettled(this.inFlight);
    return messages.length;
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pollOnce();
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        this.observability.reportError(
          SqsConsumer.name,
          'consultar_mensagens',
          error,
        );
        await delay(1_000, signal);
        continue;
      }
    }
  }

  private async process(message: Message): Promise<void> {
    const received = normalizeMessage(message);

    if (received.receiveCount > 1) {
      this.metrics?.recordRetry('sqs');
    }

    try {
      await this.handler.handle(received);
    } catch (error) {
      const retryVisibilityTimeout = calculateRetryVisibilityTimeout(
        received.receiveCount,
        this.options.retryBackoffBaseSeconds ??
          Math.max(1, this.options.visibilityTimeoutSeconds),
        this.options.retryBackoffMaxSeconds ?? 43_200,
      );
      this.observability.reportWarning(
        SqsConsumer.name,
        'processar_mensagem',
        error,
        {
          messageId: received.messageId,
          receiveCount: received.receiveCount,
          acknowledged: false,
          retryVisibilityTimeout,
        },
      );
      if (
        this.options.maxReceiveCount !== undefined &&
        received.receiveCount >= this.options.maxReceiveCount
      ) {
        this.metrics?.recordDlqMessage();
      } else {
        await this.client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: this.options.queueUrl,
          ReceiptHandle: received.receiptHandle,
          VisibilityTimeout: retryVisibilityTimeout,
        }));
      }
      return;
    }

    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: received.receiptHandle,
      }),
    );
  }
}

export function calculateRetryVisibilityTimeout(
  receiveCount: number,
  baseSeconds: number,
  maxSeconds: number,
): number {
  const exponent = Math.max(0, receiveCount - 1);
  return Math.min(maxSeconds, baseSeconds * (2 ** exponent), 43_200);
}

function normalizeMessage(message: Message): SqsReceivedMessage {
  if (
    message.MessageId === undefined ||
    message.ReceiptHandle === undefined ||
    message.Body === undefined
  ) {
    throw new Error('O SQS retornou uma mensagem incompleta');
  }

  const receiveCount = Number(
    message.Attributes?.ApproximateReceiveCount ?? '1',
  );
  return {
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    body: message.Body,
    receiveCount: Number.isSafeInteger(receiveCount) ? receiveCount : 1,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

@Injectable()
export class WagerTransactionConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private consumer: SqsConsumer | undefined;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(SQS_CONFIG) private readonly config: SqsConfig,
    private readonly infrastructure: SqsInfrastructure,
    private readonly handler: WagerTransactionMessageHandler,
    private readonly observability: Observability,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.consumer = new SqsConsumer(this.client, this.handler, {
      queueUrl: this.infrastructure.wagerTransactionsUrl,
      waitTimeSeconds: this.config.waitTimeSeconds,
      visibilityTimeoutSeconds: this.config.visibilityTimeoutSeconds,
      retryBackoffBaseSeconds: this.config.retryBackoffBaseSeconds,
      retryBackoffMaxSeconds: this.config.retryBackoffMaxSeconds,
      maxReceiveCount: this.config.maxReceiveCount,
    }, this.observability, this.metrics);
    this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
