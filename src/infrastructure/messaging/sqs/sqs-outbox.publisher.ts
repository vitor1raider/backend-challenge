import { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Optional,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { OutboxMessage } from '../../../domain/outbox/outbox-message';
import { Observability } from '../../observability/observability';
import { MikroOutboxRepository } from '../../persistence/repositories/mikro-outbox.repository';
import {
  SQS_CLIENT,
  SQS_CONFIG,
  SqsInfrastructure,
  type SqsConfig,
} from './sqs-infrastructure';
import { MetricsService } from '../../observability/metrics.service';

export interface OutboxPublishResult {
  readonly selected: number;
  readonly published: number;
  readonly retried: number;
}

@Injectable()
export class SqsOutboxPublisher
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly abortController = new AbortController();
  private running: Promise<void> | undefined;

  constructor(
    private readonly entityManager: EntityManager,
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(SQS_CONFIG) private readonly config: SqsConfig,
    private readonly infrastructure: SqsInfrastructure,
    private readonly observability: Observability,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.running = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.abortController.abort();
    await this.running;
  }

  async runOnce(now = new Date()): Promise<OutboxPublishResult> {
    return this.entityManager.fork().transactional(async (em) => {
      const repository = new MikroOutboxRepository(em);
      this.metrics?.setOutboxLag(
        await repository.findOldestPendingOccurredAt(),
        now,
      );
      const messages = await repository.findDueForUpdate(
        now,
        this.config.outboxBatchSize,
      );
      let published = 0;
      let retried = 0;

      for (const message of messages) {
        const outcome = await this.publishOne(message);
        if (outcome === 'published') {
          published += 1;
        } else {
          retried += 1;
        }
        await repository.save(message);
      }

      return { selected: messages.length, published, retried };
    });
  }

  private async run(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        const result = await this.runOnce();
        if (result.published > 0) continue;
      } catch (error) {
        this.observability.reportError(
          SqsOutboxPublisher.name,
          'processar_outbox',
          error,
        );
        await delay(
          this.config.outboxPollingIntervalMs,
          this.abortController.signal,
        );
        continue;
      }

      await delay(
        this.config.outboxPollingIntervalMs,
        this.abortController.signal,
      );
    }
  }

  private async publishOne(
    message: OutboxMessage,
  ): Promise<'published' | 'retried'> {
    try {
      await this.publish(message);
      message.markPublished(new Date());
      return 'published';
    } catch (error) {
      message.scheduleRetry(new Date());
      this.metrics?.recordRetry('outbox');
      this.observability.reportWarning(
        SqsOutboxPublisher.name,
        'publicar_mensagem',
        error,
        {
          messageId: message.id,
          aggregateId: message.aggregateId,
          attempt: message.attempts,
          retryScheduled: true,
        },
      );
      return 'retried';
    }
  }

  private async publish(message: OutboxMessage): Promise<void> {
    const result = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.infrastructure.integrationEventsUrl,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: message.aggregateId,
        MessageDeduplicationId: message.id,
      }),
    );
    if (result.MessageId === undefined) {
      throw new Error(`O SQS não confirmou a mensagem ${message.id} do outbox`);
    }
  }
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
