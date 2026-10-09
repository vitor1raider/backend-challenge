import { describe, expect, mock, test } from 'bun:test';
import type { ReprocessPendingReferencesUseCase } from '../../../../src/application/wagering/reprocess-pending-references.use-case';
import { PendingReferenceScheduler } from '../../../../src/application/wagering/pending-reference.scheduler';
import type { Observability } from '../../../../src/infrastructure/observability/observability';

describe('PendingReferenceScheduler', () => {
  test('runs the pending-reference use case', async () => {
    const execute = mock(async (_now?: Date, _limit?: number) => ({
      selected: 0,
      processed: 0,
      rescheduled: 0,
      rejected: 0,
    }));
    const scheduler = new PendingReferenceScheduler(
      { execute } as unknown as ReprocessPendingReferencesUseCase,
      { reportError: mock(() => undefined) } as unknown as Observability,
    );

    await scheduler.runOnce();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    expect(execute.mock.calls[0]?.[1]).toBe(100);
  });

  test('prevents overlapping executions', async () => {
    let release: (() => void) | undefined;
    const execute = mock(() => new Promise((resolve) => {
      release = () => resolve({
        selected: 0,
        processed: 0,
        rescheduled: 0,
        rejected: 0,
      });
    }));
    const scheduler = new PendingReferenceScheduler(
      { execute } as unknown as ReprocessPendingReferencesUseCase,
      { reportError: mock(() => undefined) } as unknown as Observability,
    );

    const first = scheduler.runOnce();
    await scheduler.runOnce();
    expect(execute).toHaveBeenCalledTimes(1);
    release?.();
    await first;
  });
});
