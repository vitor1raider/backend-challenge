import { defineEntity, p } from "@mikro-orm/postgresql";

const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessageEntity',
  tableName: 'outbox_messages',
  properties: {
    id: p.string().type('uuid').primary(),
    aggregateId: p.string().type('uuid').fieldName('aggregate_id'),
    eventType: p.string().fieldName('event_type'),
    payload: p.json(),
    attempts: p.integer(),
    occurredAt: p.datetime().fieldName('occurred_at'),
    nextAttemptAt: p.datetime().nullable().fieldName('next_attempt_at'),
    publishedAt: p.datetime().nullable().fieldName('published_at'),
  },
  indexes: [
    {
      name: 'outbox_pending_due_idx',
      properties: ['nextAttemptAt', 'occurredAt'],
      where: 'published_at is null',
    },
  ],
});

export class OutboxMessageEntity extends OutboxMessageSchema.class {}
OutboxMessageSchema.setClass(OutboxMessageEntity);
