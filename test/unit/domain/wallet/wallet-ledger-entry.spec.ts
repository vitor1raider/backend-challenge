import { describe, expect, it } from 'bun:test';
import { LedgerDirection } from '../../../../src/domain/enums/ledger-direction';
import { Money } from '../../../../src/domain/money/money';
import { WalletLedgerEntry } from '../../../../src/domain/wallet/wallet-ledger-entry';

const money = (amount: string): Money => {
  return Money.from({ amount, currency: 'BRL' });
};

const createEntry = (
  overrides: Partial<Parameters<typeof WalletLedgerEntry.create>[0]> = {},
): WalletLedgerEntry => {
  return WalletLedgerEntry.create({
    id: 'ledger-1',
    walletId: 'wallet-1',
    transactionId: 'transaction-1',
    direction: LedgerDirection.Credit,
    money: money('25.00'),
    balanceBefore: money('100.00'),
    balanceAfter: money('125.00'),
    createdAt: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  });
};

describe('WalletLedgerEntry', () => {
  it('should create a balanced credit entry', () => {
    const entry = createEntry();

    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.money.toString()).toBe('25.00');
    expect(entry.balanceAfter.toString()).toBe('125.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('should create a balanced debit entry', () => {
    const entry = createEntry({
      direction: LedgerDirection.Debit,
      balanceAfter: money('75.00'),
    });

    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('75.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('should reject an unbalanced credit entry', () => {
    expect(() =>
      createEntry({
        balanceAfter: money('124.99'),
      }),
    ).toThrow('O lançamento do ledger não está balanceado');
  });

  it('should reject an unbalanced debit entry', () => {
    expect(() =>
      createEntry({
        direction: LedgerDirection.Debit,
        balanceAfter: money('74.99'),
      }),
    ).toThrow('O lançamento do ledger não está balanceado');
  });

  it('should reject an entry with a non-positive amount', () => {
    expect(() => createEntry({ money: money('0.00') })).toThrow(
      'O valor do lançamento deve ser positivo',
    );
  });

  it('should reject an entry whose monetary values use different currencies', () => {
    expect(() =>
      createEntry({
        money: Money.from({ amount: '25.00', currency: 'USD' }),
      }),
    ).toThrow('O lançamento do ledger não está balanceado');
  });

  it('should protect the creation date from external mutation', () => {
    const createdAt = new Date('2026-10-07T12:00:00.000Z');
    const entry = createEntry({ createdAt });

    createdAt.setUTCFullYear(2030);
    const exposedDate = entry.createdAt;
    exposedDate.setUTCFullYear(2040);

    expect(entry.createdAt).toEqual(new Date('2026-10-07T12:00:00.000Z'));
  });

  it('should rehydrate persisted state without revalidating its arithmetic', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: LedgerDirection.Credit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('124.99'),
      createdAt: new Date('2026-10-07T12:00:00.000Z'),
    });

    expect(entry.isBalanced()).toBeFalse();
    expect(entry.balanceAfter.toString()).toBe('124.99');
  });
});
