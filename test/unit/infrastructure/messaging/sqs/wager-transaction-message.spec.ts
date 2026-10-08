import { describe, expect, it } from 'bun:test';
import { WagerTransactionKind } from '../../../../../src/domain/enums';
import {
  parseWagerTransactionMessage,
  SqsPermanentMessageError,
} from '../../../../../src/infrastructure/messaging/sqs/wager-transaction-message';

const validMessage = {
  messageId: 'message-1',
  type: 'WagerTransactionRequested',
  occurredAt: '2026-10-08T12:00:00.000Z',
  data: {
    providerId: 'provider-1',
    externalTransactionId: 'transaction-1',
    idempotencyKey: 'idempotency-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount: '10.00', currency: 'BRL' },
  },
} as const;

describe('parseWagerTransactionMessage', () => {
  it('parses a supported wager transaction envelope', () => {
    expect(parseWagerTransactionMessage(JSON.stringify(validMessage))).toEqual(
      validMessage,
    );
  });

  it('classifies malformed JSON as a permanent message error', () => {
    expect(() => parseWagerTransactionMessage('{')).toThrow(
      SqsPermanentMessageError,
    );
  });

  it('rejects domain-only transaction kinds at the transport boundary', () => {
    const openingMessage = {
      ...validMessage,
      data: { ...validMessage.data, kind: WagerTransactionKind.Opening },
    };

    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(openingMessage)),
    ).toThrow('data.kind não é aceito');
  });
});
