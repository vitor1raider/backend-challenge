import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessage } from '../../../domain/inbox/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export class InboxPayloadConflictError extends Error {
  constructor(messageId: string, consumerName: string) {
    super(
      `Inbox message ${messageId} for consumer ${consumerName} has a different payload`,
    );
    this.name = 'InboxPayloadConflictError';
  }
}

@Injectable()
export class MikroInboxMessageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async find(
    messageId: string,
    consumerName: string,
  ): Promise<InboxMessage | null> {
    const entity = await this.entityManager.findOne(InboxMessageEntity, {
      messageId,
      consumerName,
    });

    return entity === null ? null : this.toDomain(entity);
  }

  async exists(messageId: string, consumerName: string): Promise<boolean> {
    return (await this.find(messageId, consumerName)) !== null;
  }

  async save(message: InboxMessage): Promise<void> {
    const existing = await this.entityManager.findOne(InboxMessageEntity, {
      messageId: message.messageId,
      consumerName: message.consumerName,
    });
    const data = this.toPersistence(message);

    if (existing === null) {
      this.entityManager.persist(
        this.entityManager.create(InboxMessageEntity, data),
      );
    } else {
      if (existing.payloadHash !== message.payloadHash) {
        throw new InboxPayloadConflictError(
          message.messageId,
          message.consumerName,
        );
      }

      this.entityManager.assign(existing, data);
    }

    await this.entityManager.flush();
  }

  private toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt ?? undefined,
    });
  }

  private toPersistence(message: InboxMessage) {
    return {
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    };
  }
}
