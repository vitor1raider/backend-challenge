import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { FailureCode, LedgerDirection, WagerTransactionKind } from '../../domain/enums';
import type { IntegrationEvent } from '../../domain/events/integration-event';
import { WagerTransactionProcessed, WagerTransactionRejected } from '../../domain/events/wager-transaction';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction';
import { MikroOutboxRepository } from '../../infrastructure/persistence/repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';

export interface ReprocessPendingReferencesResult {
  readonly selected: number;
  readonly processed: number;
  readonly rescheduled: number;
  readonly rejected: number;
}

@Injectable()
export class ReprocessPendingReferencesUseCase {
  constructor(private readonly entityManager: EntityManager) {}

  async execute(now = new Date(), limit = 100): Promise<ReprocessPendingReferencesResult> {
    return this.entityManager.fork().transactional(async (em) => {
      const wagers = new MikroWagerTransactionRepository(em);
      const wallets = new MikroWalletRepository(em);
      const outbox = new MikroOutboxRepository(em);
      const pending = await wagers.findPendingReferencesDueForUpdate(now, limit);
      let processed = 0;
      let rescheduled = 0;
      let rejected = 0;

      for (const transaction of pending) {
        if (transaction.isReferenceExpired(now)) {
          await reject(transaction, FailureCode.ReferenceNotFound, wagers, outbox, now);
          rejected += 1;
          continue;
        }
        const reference = await wagers.findByExternalTransactionId(
          transaction.providerId,
          transaction.referenceExternalTransactionId!,
        );
        if (reference === null) {
          transaction.scheduleReferenceRetry(now);
          await wagers.save(transaction);
          rescheduled += 1;
          continue;
        }
        const wallet = await wallets.findById(transaction.walletId);
        if (wallet === null || wallet.playerId !== transaction.playerId) {
          await reject(transaction, FailureCode.WalletNotFound, wagers, outbox, now);
          rejected += 1;
          continue;
        }

        try {
          if ((transaction.kind === WagerTransactionKind.Refund || transaction.kind === WagerTransactionKind.Rollback)
            && await wagers.hasProcessedReversal(reference.id, transaction.kind)) {
            const code = transaction.kind === WagerTransactionKind.Refund
              ? FailureCode.ReferenceAlreadyRefunded
              : FailureCode.ReferenceAlreadyRolledBack;
            await reject(transaction, code, wagers, outbox, now, wallet.balance);
            rejected += 1;
            continue;
          }
          const direction = transaction.ledgerDirectionFor(reference);
          const entry = direction === LedgerDirection.Debit
            ? wallet.debit({ id: randomUUID(), transactionId: transaction.id, money: transaction.money, at: now })
            : wallet.credit({ id: randomUUID(), transactionId: transaction.id, money: transaction.money, at: now });
          transaction.markProcessed(reference.id, now, wallet.balance);
          await wallets.save(wallet, entry);
          await wagers.save(transaction);
          const context = { eventId: randomUUID(), correlationId: transaction.id, occurredAt: now };
          await saveEvents(outbox, [
            WagerTransactionProcessed.from(transaction, context),
            WalletBalanceChanged.from(wallet, entry, { ...context, eventId: randomUUID() }),
          ]);
          processed += 1;
        } catch (error) {
          const code = failureCodeFor(error, transaction.kind);
          if (code === undefined) throw error;
          await reject(transaction, code, wagers, outbox, now, wallet.balance);
          rejected += 1;
        }
      }
      return { selected: pending.length, processed, rescheduled, rejected };
    });
  }
}

async function reject(
  transaction: WagerTransaction,
  code: FailureCode,
  wagers: MikroWagerTransactionRepository,
  outbox: MikroOutboxRepository,
  now: Date,
  balance = transaction.resultBalance,
): Promise<void> {
  transaction.reject(code, balance);
  await wagers.save(transaction);
  await saveEvents(outbox, [WagerTransactionRejected.from(transaction, {
    eventId: randomUUID(), correlationId: transaction.id, occurredAt: now,
  })]);
}

async function saveEvents(repository: MikroOutboxRepository, events: readonly IntegrationEvent<unknown>[]): Promise<void> {
  for (const event of events) await repository.save(OutboxMessage.enqueue(event));
}

function failureCodeFor(error: unknown, kind: WagerTransactionKind): FailureCode | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.includes('Saldo insuficiente')) return kind === WagerTransactionKind.Bet
    ? FailureCode.InsufficientFunds : FailureCode.ReversalWouldCauseNegativeBalance;
  if (error.message.includes('processada')) return FailureCode.ReferenceNotProcessed;
  if (error.message.includes('outro contexto')) return FailureCode.ReferenceContextMismatch;
  if (error.message.includes('valor')) return FailureCode.ReferenceAmountMismatch;
  if (error.message.includes('pode referenciar')) return FailureCode.InvalidReferenceKind;
  return undefined;
}
