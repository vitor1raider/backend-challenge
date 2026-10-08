import { describe, expect, test } from 'bun:test';
import { WagerTransactionStatus } from '../../../../src/domain/enums';
import { MetricsService } from '../../../../src/infrastructure/observability/metrics.service';

describe('MetricsService', () => {
  test('exports every required operational metric in Prometheus format', async () => {
    const metrics = new MetricsService();

    metrics.recordWager(WagerTransactionStatus.Processed);
    metrics.recordWager(WagerTransactionStatus.Rejected);
    metrics.recordIdempotentReplay();
    metrics.recordRetry('wallet');
    metrics.recordRetry('outbox');
    metrics.recordRetry('pending_reference');
    metrics.recordRetry('sqs');
    metrics.recordDlqMessage();
    metrics.recordLockConflict();
    metrics.setOutboxLag(new Date(Date.now() - 5_000));
    metrics.recordWagerDuration(WagerTransactionStatus.Processed, 0.05);

    const output = await metrics.render();

    expect(metrics.contentType).toContain('text/plain');
    expect(output).toContain('wager_transactions_total{status="PROCESSED"} 1');
    expect(output).toContain('wager_transactions_total{status="REJECTED"} 1');
    expect(output).toContain('wager_idempotent_replays_total 1');
    expect(output).toContain('processing_retries_total{component="wallet"} 1');
    expect(output).toContain('processing_retries_total{component="outbox"} 1');
    expect(output).toContain('processing_retries_total{component="pending_reference"} 1');
    expect(output).toContain('processing_retries_total{component="sqs"} 1');
    expect(output).toContain('sqs_dlq_messages_total 1');
    expect(output).toContain('wallet_lock_conflicts_total 1');
    expect(output).toMatch(/outbox_lag_seconds 5(?:\.\d+)?/);
    expect(output).toContain(
      'wager_processing_duration_seconds_count{status="PROCESSED"} 1',
    );
  });
});
