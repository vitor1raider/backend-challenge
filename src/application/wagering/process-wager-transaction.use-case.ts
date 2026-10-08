import { createHash, randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { FailureCode, LedgerDirection, WagerTransactionKind, type WagerTransactionStatus } from '../../domain/enums';
import type { IntegrationEvent } from '../../domain/events/integration-event';
import { WagerTransactionPendingReference, WagerTransactionProcessed, WagerTransactionRejected } from '../../domain/events/wager-transaction';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed';
import { InboxMessage } from '../../domain/inbox/inbox-message';
import { Money } from '../../domain/money/money';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { WagerTransaction } from '../../domain/wagering/wager-transaction';
import { MikroOutboxRepository } from '../../infrastructure/persistence/repositories/mikro-outbox.repository';
import { MikroInboxMessageRepository } from '../../infrastructure/persistence/repositories/mikro-inbox-message.repository';
import { MikroWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository, WalletConcurrencyError } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';

export interface WagerTransactionInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: { readonly amount: string; readonly currency: string };
  readonly referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionCommand {
  readonly idempotencyKey: string;
  readonly data: WagerTransactionInput;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt?: Date;
  readonly inbox?: {
    readonly messageId: string;
    readonly consumerName: string;
  };
}

export interface ProcessWagerTransactionResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance?: { readonly amount: string; readonly currency: string };
  readonly failureCode?: FailureCode;
  readonly idempotentReplay: boolean;
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`A chave de idempotência ${key} já foi usada com outro payload`);
    this.name = 'IdempotencyConflictError';
  }
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(private readonly entityManager: EntityManager) {}

  async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.executeOnce(command);
      } catch (error) {
        if (!(error instanceof WalletConcurrencyError) || attempt === 3) throw error;
      }
    }
    throw new Error('Não foi possível processar a transação após três tentativas');
  }

  private async executeOnce(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    const payloadHash = hashWagerTransactionPayload(command.data);
    return this.entityManager.fork().transactional(async (em) => {
      const wagers = new MikroWagerTransactionRepository(em);
      const wallets = new MikroWalletRepository(em);
      const outbox = new MikroOutboxRepository(em);
      const inboxRepository = new MikroInboxMessageRepository(em);
      const existingInbox = command.inbox === undefined
        ? null
        : await inboxRepository.find(command.inbox.messageId, command.inbox.consumerName);
      if (existingInbox !== null && existingInbox.payloadHash !== payloadHash) {
        throw new IdempotencyConflictError(command.inbox?.messageId ?? command.idempotencyKey);
      }
      const inbox = command.inbox === undefined
        ? undefined
        : existingInbox ?? InboxMessage.receive({
            messageId: command.inbox.messageId,
            consumerName: command.inbox.consumerName,
            payloadHash,
            receivedAt: new Date(),
          });
      if (inbox !== undefined && existingInbox === null) await inboxRepository.save(inbox);
      const replay = await wagers.findByIdempotencyKey(command.idempotencyKey);

      if (replay !== null) {
        if (!replay.matchesPayload(payloadHash)) throw new IdempotencyConflictError(command.idempotencyKey);
        await markInboxProcessed(inbox, inboxRepository);
        return resultFrom(replay, true);
      }

      const transaction = WagerTransaction.create({
        id: randomUUID(),
        ...command.data,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        money: Money.from(command.data.money),
        createdAt: command.occurredAt ?? new Date(),
      });
      const wallet = await wallets.findById(transaction.walletId);
      const context = {
        eventId: randomUUID(),
        correlationId: command.correlationId,
        ...(command.causationId === undefined ? {} : { causationId: command.causationId }),
        occurredAt: new Date(),
      };

      if (wallet === null || wallet.playerId !== transaction.playerId) {
        await reject(transaction, FailureCode.WalletNotFound, wagers, outbox, context);
        await markInboxProcessed(inbox, inboxRepository);
        return resultFrom(transaction, false);
      }
      if (wallet.currency !== transaction.money.currency) {
        await reject(transaction, FailureCode.CurrencyMismatch, wagers, outbox, context, wallet.balance);
        await markInboxProcessed(inbox, inboxRepository);
        return resultFrom(transaction, false);
      }

      const reference = transaction.referenceExternalTransactionId === undefined
        ? undefined
        : await wagers.findByExternalTransactionId(transaction.providerId, transaction.referenceExternalTransactionId);

      if (transaction.referenceExternalTransactionId !== undefined && reference === null) {
        transaction.markPendingReference();
        transaction.scheduleReferenceRetry(new Date());
        await wagers.save(transaction);
        await saveEvents(outbox, [WagerTransactionPendingReference.from(transaction, context)]);
        await markInboxProcessed(inbox, inboxRepository);
        return resultFrom(transaction, false, wallet.balance);
      }

      if (reference && (transaction.kind === WagerTransactionKind.Refund || transaction.kind === WagerTransactionKind.Rollback)
        && await wagers.hasProcessedReversal(reference.id, transaction.kind)) {
        const code = transaction.kind === WagerTransactionKind.Refund
          ? FailureCode.ReferenceAlreadyRefunded
          : FailureCode.ReferenceAlreadyRolledBack;
        await reject(transaction, code, wagers, outbox, context, wallet.balance);
        await markInboxProcessed(inbox, inboxRepository);
        return resultFrom(transaction, false);
      }

      try {
        const direction = transaction.kind === WagerTransactionKind.Loss
          ? undefined
          : transaction.ledgerDirectionFor(reference ?? undefined);
        const entry = direction === undefined ? undefined
          : direction === LedgerDirection.Debit
            ? wallet.debit({ id: randomUUID(), transactionId: transaction.id, money: transaction.money, at: new Date() })
            : wallet.credit({ id: randomUUID(), transactionId: transaction.id, money: transaction.money, at: new Date() });

        transaction.markProcessed(reference?.id, new Date(), wallet.balance);
        if (entry !== undefined) await wallets.save(wallet, entry);
        await wagers.save(transaction);
        const events: IntegrationEvent<unknown>[] = [WagerTransactionProcessed.from(transaction, context)];
        if (entry !== undefined) events.push(WalletBalanceChanged.from(wallet, entry, { ...context, eventId: randomUUID() }));
        await saveEvents(outbox, events);
      } catch (error) {
        const failureCode = failureCodeFor(error, transaction.kind);
        if (failureCode === undefined) throw error;
        await reject(transaction, failureCode, wagers, outbox, context, wallet.balance);
      }

      await markInboxProcessed(inbox, inboxRepository);
      return resultFrom(transaction, false);
    });
  }
}

async function markInboxProcessed(
  inbox: InboxMessage | undefined,
  repository: MikroInboxMessageRepository,
): Promise<void> {
  if (inbox === undefined || inbox.isProcessed()) return;
  inbox.markProcessed(new Date());
  await repository.save(inbox);
}

export function hashWagerTransactionPayload(data: WagerTransactionInput): string {
  return createHash('sha256').update(JSON.stringify(sortObject(data))).digest('hex');
}

async function reject(
  transaction: WagerTransaction,
  code: FailureCode,
  wagers: MikroWagerTransactionRepository,
  outbox: MikroOutboxRepository,
  context: Parameters<typeof WagerTransactionRejected.from>[1],
  balance?: Money,
): Promise<void> {
  transaction.reject(code, balance);
  await wagers.save(transaction);
  await saveEvents(outbox, [WagerTransactionRejected.from(transaction, context)]);
}

async function saveEvents(repository: MikroOutboxRepository, events: readonly IntegrationEvent<unknown>[]): Promise<void> {
  for (const event of events) await repository.save(OutboxMessage.enqueue(event));
}

function resultFrom(transaction: WagerTransaction, replay: boolean, fallbackBalance?: Money): ProcessWagerTransactionResult {
  const balance = transaction.resultBalance ?? fallbackBalance;
  return {
    transactionId: transaction.id,
    status: transaction.status,
    ...(balance === undefined ? {} : { balance: balance.toJSON() }),
    ...(transaction.failureCode === undefined ? {} : { failureCode: transaction.failureCode }),
    idempotentReplay: replay,
  };
}

function failureCodeFor(error: unknown, kind: WagerTransactionKind): FailureCode | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.includes('Saldo insuficiente')) return kind === WagerTransactionKind.Bet
    ? FailureCode.InsufficientFunds : FailureCode.ReversalWouldCauseNegativeBalance;
  if (error.message.includes('moeda')) return FailureCode.CurrencyMismatch;
  if (error.message.includes('processada')) return FailureCode.ReferenceNotProcessed;
  if (error.message.includes('outro contexto')) return FailureCode.ReferenceContextMismatch;
  if (error.message.includes('valor')) return FailureCode.ReferenceAmountMismatch;
  if (error.message.includes('pode referenciar')) return FailureCode.InvalidReferenceKind;
  return undefined;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortObject(child)]));
}
