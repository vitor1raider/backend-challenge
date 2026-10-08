import { LockMode } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxMessage } from '../../../domain/outbox/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

@Injectable()
export class MikroOutboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<OutboxMessage | null> {
    const entity = await this.entityManager.findOne(OutboxMessageEntity, { id });

    return entity === null ? null : this.toDomain(entity);
  }

  async findOldestPendingOccurredAt(): Promise<Date | undefined> {
    const entity = await this.entityManager.findOne(
      OutboxMessageEntity,
      { publishedAt: null },
      { orderBy: { occurredAt: 'asc' } },
    );
    return entity?.occurredAt;
  }

  async findDue(now: Date, limit = 100): Promise<OutboxMessage[]> {
    return this.findDueWithOptions(now, limit);
  }

  async findDueForUpdate(now: Date, limit = 100): Promise<OutboxMessage[]> {
    return this.findDueWithOptions(
      now,
      limit,
      LockMode.PESSIMISTIC_PARTIAL_WRITE,
    );
  }

  private async findDueWithOptions(
    now: Date,
    limit: number,
    lockMode?: LockMode.PESSIMISTIC_PARTIAL_WRITE,
  ): Promise<OutboxMessage[]> {
    const entities = await this.entityManager.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      {
        limit,
        orderBy: { occurredAt: 'asc' },
        ...(lockMode === undefined ? {} : { lockMode }),
      },
    );

    return entities.map((entity) => this.toDomain(entity));
  }

  async save(message: OutboxMessage): Promise<void> {
    const existing = await this.entityManager.findOne(OutboxMessageEntity, {
      id: message.id,
    });
    const data = this.toPersistence(message);

    if (existing === null) {
      this.entityManager.persist(
        this.entityManager.create(OutboxMessageEntity, data),
      );
    } else {
      this.entityManager.assign(existing, data);
    }

    await this.entityManager.flush();
  }

  private toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload as Readonly<Record<string, unknown>>,
      attempts: entity.attempts,
      occurredAt: entity.occurredAt,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
    });
  }

  private toPersistence(message: OutboxMessage) {
    return {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      attempts: message.attempts,
      occurredAt: message.occurredAt,
      nextAttemptAt: message.nextAttemptAt ?? null,
      publishedAt: message.publishedAt ?? null,
    };
  }
}
