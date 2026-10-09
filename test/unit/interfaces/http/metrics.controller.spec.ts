import { describe, expect, mock, test } from 'bun:test';
import type { Response } from 'express';
import { MetricsService } from '../../../../src/infrastructure/observability/metrics.service';
import { MetricsController } from '../../../../src/interfaces/http/metrics/metrics.controller';

describe('MetricsController', () => {
  test('returns the Prometheus exposition format', async () => {
    const metrics = new MetricsService();
    const send = mock((_body: unknown) => undefined);
    const type = mock((_contentType: string) => ({ send }));
    const response = { type } as unknown as Response;

    await new MetricsController(metrics).getMetrics(response);

    expect(type).toHaveBeenCalledWith(metrics.contentType);
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toContain(
      '# HELP wager_transactions_total',
    );
  });
});
