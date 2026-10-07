import { describe, expect, it } from 'bun:test';
import { Money } from '../../../../src/domain/money/money';
import {
  FailureCode,
  InvalidTransactionStateError,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from '../../../../src/domain/wagering/wager-transaction';
import { LedgerDirection } from '../../../../src/domain/wallet/wallet-ledger-entry';

const PROCESSED_AT = new Date('2026-10-07T12:00:00.000Z');

function createTransaction(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: `${kind.toLowerCase()}-id`,
    providerId: 'provider-a',
    externalTransactionId: `${kind.toLowerCase()}-external-id`,
    idempotencyKey: `provider-a:${kind.toLowerCase()}-external-id`,
    payloadHash: `${kind.toLowerCase()}-payload-hash`,
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    createdAt: new Date('2026-10-07T11:00:00.000Z'),
    ...overrides,
  });
}

function markProcessed(transaction: WagerTransaction): WagerTransaction {
  transaction.markProcessed(
    transaction.referenceExternalTransactionId === undefined
      ? undefined
      : 'resolved-reference-id',
    PROCESSED_AT,
  );

  return transaction;
}

function processedBet(): WagerTransaction {
  return markProcessed(
    createTransaction(WagerTransactionKind.Bet, {
      id: 'bet-id',
      externalTransactionId: 'bet-external-id',
      idempotencyKey: 'provider-a:bet-external-id',
    }),
  );
}

describe('WagerTransaction business rules', () => {
  describe('BET', () => {
    it('should debit the wallet balance', () => {
      const transaction = createTransaction(WagerTransactionKind.Bet);

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.affectsBalance()).toBeTrue();
      expect(transaction.requiresReference()).toBeFalse();
      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });
  });

  describe('WIN', () => {
    it('should credit the wallet balance without requiring a reference', () => {
      const transaction = createTransaction(WagerTransactionKind.Win);

      expect(transaction.affectsBalance()).toBeTrue();
      expect(transaction.requiresReference()).toBeFalse();
      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('should optionally reference a processed bet from the same context', () => {
      const bet = processedBet();
      const win = createTransaction(WagerTransactionKind.Win, {
        referenceExternalTransactionId: bet.externalTransactionId,
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
      });

      expect(win.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    });
  });

  describe('LOSS', () => {
    it('should not affect the balance or generate a ledger direction', () => {
      const transaction = createTransaction(WagerTransactionKind.Loss);

      expect(transaction.affectsBalance()).toBeFalse();
      expect(transaction.requiresReference()).toBeFalse();
      expect(() => transaction.ledgerDirectionFor()).toThrow();
    });
  });

  describe('REFUND', () => {
    it('should require a reference external transaction id', () => {
      expect(() => createTransaction(WagerTransactionKind.Refund)).toThrow();
    });

    it('should credit the exact amount of a processed bet from the same context', () => {
      const bet = processedBet();
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: bet.externalTransactionId,
      });

      expect(refund.requiresReference()).toBeTrue();
      expect(refund.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    });

    it('should reject a reference that is not a processed bet', () => {
      const pendingBet = createTransaction(WagerTransactionKind.Bet, {
        externalTransactionId: 'bet-external-id',
      });
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: pendingBet.externalTransactionId,
      });

      expect(() => refund.ledgerDirectionFor(pendingBet)).toThrow();
    });

    it('should reject a partial refund', () => {
      const bet = processedBet();
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: bet.externalTransactionId,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      });

      expect(() => refund.ledgerDirectionFor(bet)).toThrow();
    });

    it('should only reference a processed bet', () => {
      const win = markProcessed(
        createTransaction(WagerTransactionKind.Win, {
          externalTransactionId: 'win-external-id',
        }),
      );
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: win.externalTransactionId,
      });

      expect(() => refund.ledgerDirectionFor(win)).toThrow();
    });
  });

  describe('ROLLBACK', () => {
    it('should require a reference external transaction id', () => {
      expect(() => createTransaction(WagerTransactionKind.Rollback)).toThrow();
    });

    it('should credit the wallet when reversing a processed bet', () => {
      const bet = processedBet();
      const rollback = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: bet.externalTransactionId,
      });

      expect(rollback.requiresReference()).toBeTrue();
      expect(rollback.ledgerDirectionFor(bet)).toBe(
        LedgerDirection.Credit,
      );
    });

    it('should debit the wallet when reversing a processed win', () => {
      const win = markProcessed(
        createTransaction(WagerTransactionKind.Win, {
          id: 'win-id',
          externalTransactionId: 'win-external-id',
          idempotencyKey: 'provider-a:win-external-id',
        }),
      );
      const rollback = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: win.externalTransactionId,
      });

      expect(rollback.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it('should debit the wallet when reversing a processed refund', () => {
      const bet = processedBet();
      const refund = markProcessed(
        createTransaction(WagerTransactionKind.Refund, {
          id: 'refund-id',
          externalTransactionId: 'refund-external-id',
          idempotencyKey: 'provider-a:refund-external-id',
          referenceExternalTransactionId: bet.externalTransactionId,
        }),
      );
      const rollback = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: refund.externalTransactionId,
      });

      expect(rollback.ledgerDirectionFor(refund)).toBe(
        LedgerDirection.Debit,
      );
    });

    it.each([
      ['provider', { providerId: 'provider-b' }],
      ['player', { playerId: 'player-2' }],
      ['wallet', { walletId: 'wallet-2' }],
      ['round', { roundId: 'round-2' }],
      [
        'currency',
        { money: Money.from({ amount: '25.00', currency: 'USD' }) },
      ],
    ] as const)(
      'should reject a reference with a different %s',
      (_, overrides) => {
        const bet = markProcessed(
          createTransaction(WagerTransactionKind.Bet, {
            externalTransactionId: 'bet-external-id',
            ...overrides,
          }),
        );
        const rollback = createTransaction(WagerTransactionKind.Rollback, {
          referenceExternalTransactionId: bet.externalTransactionId,
        });

        expect(() => rollback.ledgerDirectionFor(bet)).toThrow();
      },
    );

    it('should reject a rollback with an amount different from its reference', () => {
      const bet = processedBet();
      const rollback = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: bet.externalTransactionId,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      });

      expect(() => rollback.ledgerDirectionFor(bet)).toThrow();
    });

    it('should reject a reference kind other than bet, win, or refund', () => {
      const loss = markProcessed(
        createTransaction(WagerTransactionKind.Loss, {
          externalTransactionId: 'loss-external-id',
        }),
      );
      const rollback = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: loss.externalTransactionId,
      });

      expect(() => rollback.ledgerDirectionFor(loss)).toThrow();
    });
  });

  describe('state transitions', () => {
    it('should wait for a missing reference and allow processing after it is resolved', () => {
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: 'bet-external-id',
      });

      refund.markPendingReference();

      expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
      expect(refund.isTerminal()).toBeFalse();

      refund.markProcessed('bet-id', PROCESSED_AT);

      expect(refund.status).toBe(WagerTransactionStatus.Processed);
      expect(refund.referenceTransactionId).toBe('bet-id');
      expect(refund.isTerminal()).toBeTrue();
    });

    it.each([
      [WagerTransactionStatus.Processed],
      [WagerTransactionStatus.Rejected],
      [WagerTransactionStatus.Failed],
    ])('should prevent transitions from terminal status %s', (status) => {
      const transaction = createTransaction(WagerTransactionKind.Bet);

      if (status === WagerTransactionStatus.Processed) {
        transaction.markProcessed(undefined, PROCESSED_AT);
      } else if (status === WagerTransactionStatus.Rejected) {
        transaction.reject(FailureCode.InsufficientFunds);
      } else {
        transaction.fail(FailureCode.PermanentInfrastructureFailure);
      }

      expect(transaction.isTerminal()).toBeTrue();
      expect(() =>
        transaction.reject(FailureCode.InsufficientFunds),
      ).toThrow(InvalidTransactionStateError);
    });
  });

  describe('idempotency', () => {
    it('should identify an idempotency conflict when the payload hash differs', () => {
      const transaction = createTransaction(WagerTransactionKind.Bet, {
        idempotencyKey: 'provider-a:transaction-1',
        payloadHash: 'original-payload-hash',
      });

      expect(transaction.idempotencyKey).toBe('provider-a:transaction-1');
      expect(transaction.matchesPayload('original-payload-hash')).toBeTrue();
      expect(transaction.matchesPayload('different-payload-hash')).toBeFalse();
    });
  });
});
