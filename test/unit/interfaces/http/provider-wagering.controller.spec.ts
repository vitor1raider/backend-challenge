import { describe, expect, mock, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import type { GetProviderWagerTransactionUseCase } from '../../../../src/application/wagering/get-wager-transaction.use-case';
import { WagerTransactionNotFoundError } from '../../../../src/application/wagering/get-wager-transaction.use-case';
import { ProviderWageringController } from '../../../../src/interfaces/http/providers/provider-wagering.controller';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../../src/domain/enums';

describe('ProviderWageringController', () => {
  test('queries a transaction by provider and external id', async () => {
    const result = {
      id: 'transaction-id',
      providerId: 'provider-a',
      externalTransactionId: 'external-1',
      walletId: 'wallet-id',
      playerId: 'player-id',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: undefined,
      referenceTransactionId: undefined,
      failureCode: undefined,
      resultBalance: { amount: '90.00', currency: 'BRL' },
      processedAt: '2026-10-08T12:00:00.000Z',
      createdAt: '2026-10-08T12:00:00.000Z',
    };
    const execute = mock(async () => result);
    const controller = new ProviderWageringController(
      { execute } as unknown as GetProviderWagerTransactionUseCase,
    );

    expect(await controller.getByExternalId('provider-a', 'external-1')).toEqual(result);
    expect(execute).toHaveBeenCalledWith('provider-a', 'external-1');
  });

  test('maps a missing transaction to HTTP 404', async () => {
    const execute = mock(async () => { throw new WagerTransactionNotFoundError('external-1'); });
    const controller = new ProviderWageringController(
      { execute } as unknown as GetProviderWagerTransactionUseCase,
    );

    expect(controller.getByExternalId('provider-a', 'external-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
