import type { IntegrationEvent } from '../events/integration-event';

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

export class OutboxMessageAlreadyPublishedError extends Error {
  constructor(id: string) {
    super(`A mensagem de outbox ${id} já foi publicada`);
    this.name = 'OutboxMessageAlreadyPublishedError';
  }
}

export class OutboxMessage {
  private readonly _payload: Readonly<Record<string, unknown>>;
  private readonly _occurredAt: Date;
  private _nextAttemptAt: Date | undefined;
  private _publishedAt: Date | undefined;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    payload: Readonly<Record<string, unknown>>,
    occurredAt: Date,
    private _attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
  ) {
    this._payload = cloneAndFreeze(payload);
    this._occurredAt = new Date(occurredAt.getTime());
    this._nextAttemptAt = cloneDate(nextAttemptAt);
    this._publishedAt = cloneDate(publishedAt);
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    assertRequiredText(event.eventId, 'eventId');
    assertRequiredText(event.aggregateId, 'aggregateId');
    assertRequiredText(event.eventType, 'eventType');
    assertValidDate(event.occurredAt, 'occurredAt');

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON(),
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get payload(): Readonly<Record<string, unknown>> {
    return this._payload;
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return cloneDate(this._nextAttemptAt);
  }

  get publishedAt(): Date | undefined {
    return cloneDate(this._publishedAt);
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    assertValidDate(now, 'now');

    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined ||
        this._nextAttemptAt.getTime() <= now.getTime())
    );
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError(this.id);
    }

    assertValidDate(at, 'publishedAt');
    this._publishedAt = new Date(at.getTime());
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError(this.id);
    }

    assertValidDate(now, 'now');
    this._attempts += 1;

    const exponent = Math.min(this._attempts - 1, 30);
    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** exponent,
      MAX_RETRY_DELAY_MS,
    );

    this._nextAttemptAt = new Date(now.getTime() + delay);
  }
}

function assertRequiredText(value: string, field: string): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error(`${field} é obrigatório e não pode conter espaços externos`);
  }
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} deve ser uma data válida`);
  }
}

function cloneDate(value: Date | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value.getTime());
}

function cloneAndFreeze(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze(structuredClone(payload));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}
