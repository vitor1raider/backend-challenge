import { describe, expect, it } from 'bun:test';
import { Money } from '../../../../src/domain/money/money';
import { LedgerDirection } from '../../../../src/domain/wallet/wallet-ledger-entry';
import { Wallet } from '../../../../src/domain/wallet/wallet';

const WALLET_ID = 'wallet-1';
const PLAYER_ID = 'player-1';

const money = (amount: string): Money => {
  return Money.from({ amount, currency: 'BRL' });
};

describe('Wallet', () => {
  it('should open with version one and the provided initial balance', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('100.00'),
    });

    expect(wallet.id).toBe(WALLET_ID);
    expect(wallet.playerId).toBe(PLAYER_ID);
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('should reject a negative initial balance', () => {
    const negativeBalance = money('1.00').negate();

    expect(() =>
      Wallet.open({
        id: WALLET_ID,
        playerId: PLAYER_ID,
        initialBalance: negativeBalance,
      }),
    ).toThrow();
  });

  it('should debit the balance and return a balanced debit ledger entry', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('100.00'),
    });
    const occurredAt = new Date('2026-10-07T12:00:00.000Z');

    const entry = wallet.debit({
      id: 'ledger-1',
      transactionId: 'transaction-1',
      money: money('25.00'),
      at: occurredAt,
    });

    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(occurredAt);
    expect(entry.walletId).toBe(WALLET_ID);
    expect(entry.transactionId).toBe('transaction-1');
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('75.00');
    expect(entry.isBalanced()).toBeTrue();
  });

  it('should credit the balance and return a balanced credit ledger entry', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('100.00'),
    });

    const entry = wallet.credit({
      id: 'ledger-1',
      transactionId: 'transaction-1',
      money: money('25.00'),
      at: new Date('2026-10-07T12:00:00.000Z'),
    });

    expect(wallet.balance.toString()).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('125.00');
    expect(entry.isBalanced()).toBeTrue();
  });

  it('should reject a debit that would make the balance negative without changing state', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('20.00'),
    });
    const updatedAtBeforeAttempt = wallet.updatedAt;

    expect(() =>
      wallet.debit({
        id: 'ledger-1',
        transactionId: 'transaction-1',
        money: money('25.00'),
        at: new Date('2026-10-07T12:00:00.000Z'),
      }),
    ).toThrow();

    expect(wallet.balance.toString()).toBe('20.00');
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(updatedAtBeforeAttempt);
  });

  it('should reject a movement in a different currency without changing state', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('100.00'),
    });

    expect(() =>
      wallet.credit({
        id: 'ledger-1',
        transactionId: 'transaction-1',
        money: Money.from({ amount: '10.00', currency: 'USD' }),
        at: new Date('2026-10-07T12:00:00.000Z'),
      }),
    ).toThrow();

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('should reject a zero-value movement without changing the wallet version', () => {
    const wallet = Wallet.open({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      initialBalance: money('100.00'),
    });

    expect(() =>
      wallet.credit({
        id: 'ledger-1',
        transactionId: 'transaction-1',
        money: money('0.00'),
        at: new Date('2026-10-07T12:00:00.000Z'),
      }),
    ).toThrow();

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('should rehydrate the persisted state without changing it', () => {
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    const updatedAt = new Date('2026-10-07T12:00:00.000Z');

    const wallet = Wallet.rehydrate({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      currency: 'BRL',
      balance: money('75.00'),
      version: 4,
      createdAt,
      updatedAt,
    });

    expect(wallet.id).toBe(WALLET_ID);
    expect(wallet.playerId).toBe(PLAYER_ID);
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(4);
    expect(wallet.createdAt).toEqual(createdAt);
    expect(wallet.updatedAt).toEqual(updatedAt);
  });
});
