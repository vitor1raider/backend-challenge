import type { Money } from '../money/money';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type LedgerEntryState = Readonly<CreateLedgerEntryProps>;

export class WalletLedgerEntry {
  private readonly _createdAt: Date;

  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this._createdAt = new Date(createdAt.getTime());
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.assertValidProps(props);

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new Error('O lançamento do ledger não está balanceado');
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    try {
      const expectedBalance =
        this.direction === LedgerDirection.Credit
          ? this.balanceBefore.add(this.money)
          : this.balanceBefore.subtract(this.money);

      return expectedBalance.equals(this.balanceAfter);
    } catch {
      return false;
    }
  }

  private static assertValidProps(props: CreateLedgerEntryProps): void {
    if (
      props.id.trim().length === 0 ||
      props.walletId.trim().length === 0 ||
      props.transactionId.trim().length === 0
    ) {
      throw new Error(
        'Id, walletId e transactionId são obrigatórios para o ledger',
      );
    }

    if (
      !(props.createdAt instanceof Date) ||
      Number.isNaN(props.createdAt.getTime())
    ) {
      throw new Error('A data de criação do lançamento é inválida');
    }

    if (!props.money.isPositive()) {
      throw new Error('O valor do lançamento deve ser positivo');
    }

    if (
      props.direction !== LedgerDirection.Credit &&
      props.direction !== LedgerDirection.Debit
    ) {
      throw new Error('A direção do lançamento é inválida');
    }
  }
}
