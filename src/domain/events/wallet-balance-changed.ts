import type { Wallet } from '../wallet/wallet';
import type { LedgerDirection } from '../enums/ledger-direction';
import type { WalletLedgerEntry } from '../wallet/wallet-ledger-entry';
import {
  IntegrationEvent,
  type EventContext,
} from './integration-event';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: { amount: string; currency: string };
  balanceBefore: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string };
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  private constructor(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ) {
    super({
      eventId: context.eventId,
      aggregateId: wallet.id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined
        ? {}
        : { causationId: context.causationId }),
      occurredAt: context.occurredAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
  
  static create(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ): WalletBalanceChanged {
    if (entry.walletId !== wallet.id) {
      throw new Error('O lançamento do ledger não pertence à wallet');
    }

    if (!entry.isBalanced()) {
      throw new Error('O lançamento do ledger deve estar balanceado');
    }

    if (!wallet.balance.equals(entry.balanceAfter)) {
      throw new Error('O saldo da wallet deve corresponder ao saldo final do ledger');
    }

    return new WalletBalanceChanged(wallet, entry, context);
  }

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ): WalletBalanceChanged {
    if (entry.walletId !== wallet.id) {
      throw new Error('O lançamento do ledger não pertence à wallet');
    }

    if (!entry.isBalanced()) {
      throw new Error('O lançamento do ledger deve estar balanceado');
    }

    if (!wallet.balance.equals(entry.balanceAfter)) {
      throw new Error('O saldo da wallet deve corresponder ao saldo final do ledger');
    }

    return new WalletBalanceChanged(wallet, entry, context);
  }
}
