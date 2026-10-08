import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { GetWalletLedgerUseCase } from '../../../../src/application/wallet/get-wallet-ledger.use-case';
import { InvalidLedgerCursorError } from '../../../../src/application/wallet/get-wallet-ledger.use-case';
import type { GetWalletUseCase } from '../../../../src/application/wallet/get-wallet.use-case';
import { WalletNotFoundError } from '../../../../src/application/wallet/get-wallet.use-case';
import { WalletController } from '../../../../src/interfaces/http/wallet/wallet.controller';
import type { CreateWalletUseCase } from '../../../../src/application/wallet/create-wallet.use-case';
import { WalletAlreadyExistsError } from '../../../../src/application/wallet/create-wallet.use-case';
import type { ReconcileWalletUseCase } from '../../../../src/application/wallet/reconcile-wallet.use-case';

const walletId = '0192f291-27dd-7d3f-8071-5f8685deef37';

describe('WalletController', () => {
  test('creates a wallet through the use case', async () => {
    const result = {
      id: walletId,
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      balance: { amount: '1000.00', currency: 'BRL' },
      version: 1,
    };
    const create = mock(async () => result);
    const controller = createController(mock(async () => undefined), mock(async () => undefined), create);

    expect(await controller.createWallet({
      playerId: result.playerId,
      initialBalance: result.balance,
    }, 'correlation-1')).toEqual(result);
    expect(create).toHaveBeenCalledWith({
      playerId: result.playerId,
      initialBalance: result.balance,
      correlationId: 'correlation-1',
    });
  });

  test('maps a duplicate wallet to HTTP 409', async () => {
    const create = mock(async () => {
      throw new WalletAlreadyExistsError('player-1', 'BRL');
    });
    const controller = createController(mock(async () => undefined), mock(async () => undefined), create);

    expect(controller.createWallet({
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    })).rejects.toBeInstanceOf(ConflictException);
  });

  test('returns a wallet from the query use case', async () => {
    const result = {
      id: walletId,
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    };
    const execute = mock(async () => result);
    const controller = createController(execute, mock(async () => ({ items: [] })));

    expect(await controller.getWallet(walletId)).toEqual(result);
    expect(execute).toHaveBeenCalledWith(walletId);
  });

  test('maps a missing wallet to HTTP 404', async () => {
    const execute = mock(async () => { throw new WalletNotFoundError(walletId); });
    const controller = createController(execute, mock(async () => ({ items: [] })));

    expect(controller.getWallet(walletId)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('passes cursor and limit to the ledger query use case', async () => {
    const execute = mock(async () => ({ items: [], nextCursor: undefined }));
    const controller = createController(mock(async () => undefined), execute);

    await controller.getWalletLedger(walletId, 'opaque-cursor', 25);

    expect(execute).toHaveBeenCalledWith({ walletId, cursor: 'opaque-cursor', limit: 25 });
  });

  test('maps invalid pagination to HTTP 400', async () => {
    const invalidCursor = mock(async () => { throw new InvalidLedgerCursorError(); });
    const controller = createController(mock(async () => undefined), invalidCursor);

    expect(controller.getWalletLedger(walletId, 'invalid', 50)).rejects.toBeInstanceOf(BadRequestException);
    expect(controller.getWalletLedger(walletId, undefined, 101)).rejects.toBeInstanceOf(BadRequestException);
  });

  test('reconciles a wallet through the use case', async () => {
    const result = {
      walletId,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    };
    const reconcile = mock(async () => result);
    const controller = createController(
      mock(async () => undefined),
      mock(async () => undefined),
      mock(async () => undefined),
      reconcile,
    );

    expect(await controller.reconcileWallet(walletId)).toEqual(result);
    expect(reconcile).toHaveBeenCalledWith(walletId);
  });
});

function createController(
  getWallet: (...args: never[]) => Promise<unknown>,
  getLedger: (...args: never[]) => Promise<unknown>,
  createWallet: (...args: never[]) => Promise<unknown> = mock(async () => undefined),
  reconcileWallet: (...args: never[]) => Promise<unknown> = mock(async () => undefined),
): WalletController {
  return new WalletController(
    { execute: createWallet } as unknown as CreateWalletUseCase,
    { execute: getWallet } as unknown as GetWalletUseCase,
    { execute: getLedger } as unknown as GetWalletLedgerUseCase,
    { execute: reconcileWallet } as unknown as ReconcileWalletUseCase,
  );
}
