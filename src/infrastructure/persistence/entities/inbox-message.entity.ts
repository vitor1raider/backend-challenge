import { defineEntity, p } from '@mikro-orm/postgresql';

const InboxMessageSchema = defineEntity({
  name: 'InboxMessageEntity',
  tableName: 'inbox_messages',
  properties: {
    messageId: p.string().fieldName('message_id').primary(),
    consumerName: p.string().fieldName('consumer_name').primary(),
    payloadHash: p.string().fieldName('payload_hash'),
    receivedAt: p.datetime().fieldName('received_at'),
    processedAt: p.datetime().fieldName('processed_at').nullable(),
  },
});

export class InboxMessageEntity extends InboxMessageSchema.class {}
InboxMessageSchema.setClass(InboxMessageEntity);
