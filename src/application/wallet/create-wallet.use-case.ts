import { createHash, randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { LedgerDirection, WagerTransactionKind } from '../../domain/enums';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed';
import { Money } from '../../domain/money/money';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { WagerTransaction } from '../../domain/wagering/wager-transaction';
import { Wallet } from '../../domain/wallet/wallet';
import { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry';
import { MikroOutboxRepository } from '../../infrastructure/persistence/repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';

export interface CreateWalletCommand {
  readonly playerId: string;
  readonly initialBalance: { readonly amount: string; readonly currency: string };
  readonly correlationId: string;
}

export interface WalletResult {
  readonly id: string;
  readonly playerId: string;
  readonly balance: { readonly amount: string; readonly currency: string };
  readonly version: number;
}

export class WalletAlreadyExistsError extends Error {
  constructor(playerId: string, currency: string) {
    super(`Já existe uma wallet para ${playerId} em ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly entityManager: EntityManager) {}

  async execute(command: CreateWalletCommand): Promise<WalletResult> {
    return this.entityManager.fork().transactional(async (em) => {
      const wallets = new MikroWalletRepository(em);
      const wagers = new MikroWagerTransactionRepository(em);
      const outbox = new MikroOutboxRepository(em);
      const initialBalance = Money.from(command.initialBalance);
      if (await wallets.findByPlayerAndCurrency(command.playerId, initialBalance.currency)) {
        throw new WalletAlreadyExistsError(command.playerId, initialBalance.currency);
      }

      const wallet = Wallet.open({ id: randomUUID(), playerId: command.playerId, initialBalance });
      if (initialBalance.isZero()) {
        await wallets.save(wallet);
        return toWalletResult(wallet);
      }

      const transactionId = randomUUID();
      const now = new Date();
      const transaction = WagerTransaction.create({
        id: transactionId,
        providerId: 'internal',
        externalTransactionId: `opening:${wallet.id}`,
        idempotencyKey: `opening:${wallet.id}`,
        payloadHash: createHash('sha256').update(`opening:${wallet.id}:${initialBalance.toString()}:${initialBalance.currency}`).digest('hex'),
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'opening',
        gameId: 'opening',
        kind: WagerTransactionKind.Opening,
        money: initialBalance,
        createdAt: now,
      });
      const entry = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: wallet.id,
        transactionId,
        direction: LedgerDirection.Credit,
        money: initialBalance,
        balanceBefore: Money.zero(initialBalance.currency),
        balanceAfter: initialBalance,
        createdAt: now,
      });
      transaction.markProcessed(undefined, now, initialBalance);
      await wallets.save(wallet, entry);
      await wagers.save(transaction);
      const context = { eventId: randomUUID(), correlationId: command.correlationId, occurredAt: now };
      await outbox.save(OutboxMessage.enqueue(WagerTransactionProcessed.from(transaction, context)));
      await outbox.save(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, { ...context, eventId: randomUUID() })));
      return toWalletResult(wallet);
    });
  }
}

function toWalletResult(wallet: Wallet): WalletResult {
  return { id: wallet.id, playerId: wallet.playerId, balance: wallet.balance.toJSON(), version: wallet.version };
}
