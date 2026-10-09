import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Observability } from '../../infrastructure/observability/observability';
import { ReprocessPendingReferencesUseCase } from './reprocess-pending-references.use-case';

const POLLING_INTERVAL_MS = readInteger(
  'PENDING_REFERENCE_POLLING_INTERVAL_MS',
  1_000,
  1,
);
const BATCH_SIZE = readInteger('PENDING_REFERENCE_BATCH_SIZE', 100, 1);

@Injectable()
export class PendingReferenceScheduler {
  private running = false;

  constructor(
    private readonly useCase: ReprocessPendingReferencesUseCase,
    private readonly observability: Observability,
  ) {}

  @Interval('pending-reference-reprocessing', POLLING_INTERVAL_MS)
  async runOnce(): Promise<void> {
    if (
      this.running ||
      process.env.PENDING_REFERENCE_REPROCESSING_ENABLED === 'false'
    ) return;

    this.running = true;
    try {
      await this.useCase.execute(new Date(), BATCH_SIZE);
    } catch (error) {
      this.observability.reportError(
        PendingReferenceScheduler.name,
        'reprocessar_referencias_pendentes',
        error,
      );
    } finally {
      this.running = false;
    }
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
