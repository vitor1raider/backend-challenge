import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { WagerTransactionStatus } from '../../domain/enums';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly wagerTransactions = new Counter({
    name: 'wager_transactions_total',
    help: 'Total number of new wager transactions by final observed status',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  private readonly idempotentReplays = new Counter({
    name: 'wager_idempotent_replays_total',
    help: 'Total number of idempotent wager replays',
    registers: [this.registry],
  });
  private readonly retries = new Counter({
    name: 'processing_retries_total',
    help: 'Total number of processing retries by component',
    labelNames: ['component'] as const,
    registers: [this.registry],
  });
  private readonly dlqMessages = new Counter({
    name: 'sqs_dlq_messages_total',
    help: 'Total number of messages that exhausted their SQS receive limit',
    registers: [this.registry],
  });
  private readonly lockConflicts = new Counter({
    name: 'wallet_lock_conflicts_total',
    help: 'Total number of optimistic wallet lock conflicts',
    registers: [this.registry],
  });
  private readonly outboxLag = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age in seconds of the oldest unpublished outbox message',
    registers: [this.registry],
  });
  private readonly wagerDuration = new Histogram({
    name: 'wager_processing_duration_seconds',
    help: 'Wager processing duration in seconds',
    labelNames: ['status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  recordWager(status: WagerTransactionStatus): void {
    this.wagerTransactions.inc({ status });
  }

  recordIdempotentReplay(): void {
    this.idempotentReplays.inc();
  }

  recordRetry(component: 'wallet' | 'outbox' | 'pending_reference' | 'sqs'): void {
    this.retries.inc({ component });
  }

  recordDlqMessage(): void {
    this.dlqMessages.inc();
  }

  recordLockConflict(): void {
    this.lockConflicts.inc();
  }

  setOutboxLag(oldestOccurredAt: Date | undefined, now = new Date()): void {
    const lag = oldestOccurredAt === undefined
      ? 0
      : Math.max(0, (now.getTime() - oldestOccurredAt.getTime()) / 1_000);
    this.outboxLag.set(lag);
  }

  recordWagerDuration(status: WagerTransactionStatus | 'ERROR', seconds: number): void {
    this.wagerDuration.observe({ status }, seconds);
  }
}
