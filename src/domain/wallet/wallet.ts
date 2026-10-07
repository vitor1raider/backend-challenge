import { Money } from '../money/money';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from './wallet-ledger-entry';

export interface WalletMovement {
  id: string;
  transactionId: string;
  money: Money;
  at: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    if (!props.id || !props.playerId || !props.initialBalance) {
      throw new Error(
        'Todos os campos são obrigatórios para abrir uma wallet.',
      );
    }

    if (props.initialBalance.isNegative()) {
      throw new Error('O saldo inicial da wallet não pode ser negativo.');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      new Date(),
      new Date(),
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      new Date(state.createdAt.getTime()),
      new Date(state.updatedAt.getTime()),
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidMovement(movement);

    if (this._balance.isLessThan(movement.money)) {
      throw new Error('Saldo insuficiente para realizar a movimentação.');
    }

    return this.applyMovement(movement, LedgerDirection.Debit);
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidMovement(movement);

    return this.applyMovement(movement, LedgerDirection.Credit);
  }

  private applyMovement(
    movement: WalletMovement,
    direction: LedgerDirection,
  ): WalletLedgerEntry {
    const balanceBefore = this._balance;
    const balanceAfter =
      direction === LedgerDirection.Debit
        ? this._balance.subtract(movement.money)
        : this._balance.add(movement.money);

    const entry = WalletLedgerEntry.create({
      id: movement.id,
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      money: movement.money,
      balanceBefore,
      balanceAfter,
      createdAt: movement.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date(movement.at.getTime());

    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new Error(
        'A moeda de movimentação deve ser igual à moeda da wallet.',
      );
    }
  }

  private assertValidMovement(movement: WalletMovement): void {
    if (
      !movement.id ||
      !movement.transactionId ||
      !movement.money ||
      !(movement.at instanceof Date) ||
      Number.isNaN(movement.at.getTime())
    ) {
      throw new Error('Todos os campos da movimentação são obrigatórios.');
    }

    this.assertSameCurrency(movement.money);

    if (!movement.money.isPositive()) {
      throw new Error('O valor da movimentação deve ser positivo.');
    }
  }
}
