import { Injectable } from '@nestjs/common';
import {
  IdempotencyConflictError,
  ProcessWagerTransactionUseCase,
} from '../../../application/wagering/process-wager-transaction.use-case';
import type { SqsMessageHandler, SqsReceivedMessage } from './sqs-consumer';
import {
  parseWagerTransactionMessage,
  SqsPermanentMessageError,
} from './wager-transaction-message';

const CONSUMER_NAME = 'wager-transaction-consumer-v1';

@Injectable()
export class WagerTransactionMessageHandler implements SqsMessageHandler {
  constructor(private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase) {}

  async handle(message: SqsReceivedMessage): Promise<void> {
    const envelope = parseWagerTransactionMessage(message.body);
    const { idempotencyKey, ...data } = envelope.data;

    try {
      await this.processWagerTransactionUseCase.execute({
        idempotencyKey,
        data,
        correlationId: envelope.messageId,
        causationId: message.messageId,
        occurredAt: new Date(envelope.occurredAt),
        inbox: {
          messageId: envelope.messageId,
          consumerName: CONSUMER_NAME,
        },
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new SqsPermanentMessageError(error.message);
      }
      throw error;
    }
  }
}
