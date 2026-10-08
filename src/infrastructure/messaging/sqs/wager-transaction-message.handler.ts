import { createHash, randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { FailureCode, LedgerDirection, WagerTransactionKind } from '../../../domain/enums';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../../domain/events/wager-transaction';
import { WalletBalanceChanged } from '../../../domain/events/wallet-balance-changed';
import type { IntegrationEvent } from '../../../domain/events/integration-event';
import { InboxMessage } from '../../../domain/inbox/inbox-message';
import { Money } from '../../../domain/money/money';
import { OutboxMessage } from '../../../domain/outbox/outbox-message';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { MikroInboxMessageRepository } from '../../persistence/repositories/mikro-inbox-message.repository';
import { MikroOutboxRepository } from '../../persistence/repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from '../../persistence/repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from '../../persistence/repositories/mikro-wallet.repository';
import type { SqsMessageHandler, SqsReceivedMessage } from './sqs-consumer';
import {
  parseWagerTransactionMessage,
  SqsPermanentMessageError,
  type WagerTransactionMessage,
} from './wager-transaction-message';

const CONSUMER_NAME = 'wager-transaction-consumer-v1';

@Injectable()
export class WagerTransactionMessageHandler implements SqsMessageHandler {
  constructor(private readonly entityManager: EntityManager) {}

  async handle(message: SqsReceivedMessage): Promise<void> {
    const envelope = parseWagerTransactionMessage(message.body);
    const payloadHash = createHash('sha256')
      .update(canonicalJson(envelope.data))
      .digest('hex');

    await this.entityManager.fork().transactional(async (em) => {
      await this.process(em, envelope, payloadHash, message.messageId);
    });
  }

  private async process(
    em: EntityManager,
    envelope: WagerTransactionMessage,
    payloadHash: string,
    transportMessageId: string,
  ): Promise<void> {
    const inboxRepository = new MikroInboxMessageRepository(em);
    const wagerRepository = new MikroWagerTransactionRepository(em);
    const walletRepository = new MikroWalletRepository(em);
    const outboxRepository = new MikroOutboxRepository(em);
    const existingInbox = await inboxRepository.find(
      envelope.messageId,
      CONSUMER_NAME,
    );

    if (existingInbox !== null) {
      if (existingInbox.payloadHash !== payloadHash) {
        throw new SqsPermanentMessageError(
          `A mensagem ${envelope.messageId} foi recebida novamente com um payload diferente`,
        );
      }
      if (existingInbox.isProcessed()) return;
    }

    const inbox =
      existingInbox ??
      InboxMessage.receive({
        messageId: envelope.messageId,
        consumerName: CONSUMER_NAME,
        payloadHash,
        receivedAt: new Date(),
      });
    await inboxRepository.save(inbox);

    const replay = await wagerRepository.findByIdempotencyKey(
      envelope.data.idempotencyKey,
    );
    if (replay !== null) {
      if (!replay.matchesPayload(payloadHash)) {
        throw new SqsPermanentMessageError(
          `A chave de idempotência ${envelope.data.idempotencyKey} possui um payload diferente`,
        );
      }
      inbox.markProcessed(new Date());
      await inboxRepository.save(inbox);
      return;
    }

    const occurredAt = new Date(envelope.occurredAt);
    const transaction = WagerTransaction.create({
      id: randomUUID(),
      providerId: envelope.data.providerId,
      externalTransactionId: envelope.data.externalTransactionId,
      idempotencyKey: envelope.data.idempotencyKey,
      payloadHash,
      walletId: envelope.data.walletId,
      playerId: envelope.data.playerId,
      roundId: envelope.data.roundId,
      gameId: envelope.data.gameId,
      kind: envelope.data.kind,
      money: Money.from(envelope.data.money),
      ...(envelope.data.referenceExternalTransactionId === undefined
        ? {}
        : {
            referenceExternalTransactionId:
              envelope.data.referenceExternalTransactionId,
          }),
      createdAt: occurredAt,
    });
    const context = {
      correlationId: envelope.messageId,
      causationId: transportMessageId,
      occurredAt: new Date(),
    };
    const wallet = await walletRepository.findById(transaction.walletId);

    if (wallet === null || wallet.playerId !== transaction.playerId) {
      await this.reject(
        transaction,
        FailureCode.WalletNotFound,
        wagerRepository,
        outboxRepository,
        context,
      );
      await markInboxProcessed(inbox, inboxRepository);
      return;
    }

    if (wallet.currency !== transaction.money.currency) {
      await this.reject(
        transaction,
        FailureCode.CurrencyMismatch,
        wagerRepository,
        outboxRepository,
        context,
      );
      await markInboxProcessed(inbox, inboxRepository);
      return;
    }

    const reference =
      transaction.referenceExternalTransactionId === undefined
        ? undefined
        : await wagerRepository.findByExternalTransactionId(
            transaction.providerId,
            transaction.referenceExternalTransactionId,
          );

    if (
      transaction.referenceExternalTransactionId !== undefined &&
      reference === null
    ) {
      transaction.markPendingReference();
      await wagerRepository.save(transaction);
      await saveEvents(outboxRepository, [
        WagerTransactionPendingReference.from(transaction, {
          ...context,
          eventId: randomUUID(),
        }),
      ]);
      await markInboxProcessed(inbox, inboxRepository);
      return;
    }

    if (
      reference !== undefined &&
      reference !== null &&
      (transaction.kind === WagerTransactionKind.Refund ||
        transaction.kind === WagerTransactionKind.Rollback) &&
      (await wagerRepository.hasProcessedReversal(
        reference.id,
        transaction.kind,
      ))
    ) {
      await this.reject(
        transaction,
        transaction.kind === WagerTransactionKind.Refund
          ? FailureCode.ReferenceAlreadyRefunded
          : FailureCode.ReferenceAlreadyRolledBack,
        wagerRepository,
        outboxRepository,
        context,
      );
      await markInboxProcessed(inbox, inboxRepository);
      return;
    }

    try {
      const direction =
        transaction.kind === WagerTransactionKind.Loss
          ? undefined
          : transaction.ledgerDirectionFor(reference ?? undefined);
      const ledgerEntry =
        direction === undefined
          ? undefined
          : direction === LedgerDirection.Debit
            ? wallet.debit({
                id: randomUUID(),
                transactionId: transaction.id,
                money: transaction.money,
                at: new Date(),
              })
            : wallet.credit({
                id: randomUUID(),
                transactionId: transaction.id,
                money: transaction.money,
                at: new Date(),
              });

      transaction.markProcessed(reference?.id, new Date());
      if (ledgerEntry !== undefined) {
        await walletRepository.save(wallet, ledgerEntry);
      }
      await wagerRepository.save(transaction);

      const events: IntegrationEvent<unknown>[] = [
        WagerTransactionProcessed.from(transaction, {
          ...context,
          eventId: randomUUID(),
        }),
      ];
      if (ledgerEntry !== undefined) {
        events.push(
          WalletBalanceChanged.from(wallet, ledgerEntry, {
            ...context,
            eventId: randomUUID(),
          }),
        );
      }
      await saveEvents(outboxRepository, events);
    } catch (error) {
      const failureCode = failureCodeFor(error, transaction.kind);
      if (failureCode === undefined) throw error;
      await this.reject(
        transaction,
        failureCode,
        wagerRepository,
        outboxRepository,
        context,
      );
    }

    await markInboxProcessed(inbox, inboxRepository);
  }

  private async reject(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    wagerRepository: MikroWagerTransactionRepository,
    outboxRepository: MikroOutboxRepository,
    context: {
      correlationId: string;
      causationId: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    transaction.reject(failureCode);
    await wagerRepository.save(transaction);
    await saveEvents(outboxRepository, [
      WagerTransactionRejected.from(transaction, {
        ...context,
        eventId: randomUUID(),
      }),
    ]);
  }
}

async function markInboxProcessed(
  inbox: InboxMessage,
  repository: MikroInboxMessageRepository,
): Promise<void> {
  inbox.markProcessed(new Date());
  await repository.save(inbox);
}

async function saveEvents(
  repository: MikroOutboxRepository,
  events: readonly IntegrationEvent<unknown>[],
): Promise<void> {
  for (const event of events) {
    await repository.save(OutboxMessage.enqueue(event));
  }
}

function failureCodeFor(
  error: unknown,
  kind: WagerTransactionKind,
): FailureCode | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.includes('Saldo insuficiente')) {
    return kind === WagerTransactionKind.Bet
      ? FailureCode.InsufficientFunds
      : FailureCode.ReversalWouldCauseNegativeBalance;
  }
  if (error.message.includes('moeda')) return FailureCode.CurrencyMismatch;
  if (error.message.includes('processada')) {
    return FailureCode.ReferenceNotProcessed;
  }
  if (error.message.includes('outro contexto')) {
    return FailureCode.ReferenceContextMismatch;
  }
  if (error.message.includes('valor')) {
    return FailureCode.ReferenceAmountMismatch;
  }
  if (error.message.includes('pode referenciar')) {
    return FailureCode.InvalidReferenceKind;
  }
  return undefined;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}
