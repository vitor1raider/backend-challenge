import { describe, expect, mock, test } from 'bun:test';
import type { Response } from 'express';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../../src/domain/enums';
import type { GetWagerTransactionUseCase } from '../../../../src/application/wagering/get-wager-transaction.use-case';
import { WagerTransactionNotFoundError } from '../../../../src/application/wagering/get-wager-transaction.use-case';
import type { ProcessWagerTransactionUseCase } from '../../../../src/application/wagering/process-wager-transaction.use-case';
import { IdempotencyConflictError } from '../../../../src/application/wagering/process-wager-transaction.use-case';
import { WageringController } from '../../../../src/interfaces/http/wagering/wagering.controller';

const body = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-1',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: { amount: '25.00', currency: 'BRL' },
};

describe('WageringController', () => {
  test('submits a processed transaction as HTTP 201', async () => {
    const result = { transactionId: 'transaction-id', status: WagerTransactionStatus.Processed, idempotentReplay: false };
    const process = mock(async () => result);
    const { controller, response, status } = createController(process);

    expect(await controller.submit(body, 'key-1', 'correlation-1', response)).toEqual(result);
    expect(status).toHaveBeenCalledWith(201);
  });

  test('submits a pending reference as HTTP 202', async () => {
    const process = mock(async () => ({ transactionId: 'id', status: WagerTransactionStatus.PendingReference, idempotentReplay: false }));
    const { controller, response, status } = createController(process);

    await controller.submit(body, 'key-1', undefined, response);
    expect(status).toHaveBeenCalledWith(202);
  });

  test('maps business rejection and idempotency conflict', async () => {
    const rejected = createController(mock(async () => ({
      transactionId: 'id', status: WagerTransactionStatus.Rejected, idempotentReplay: false,
    })));
    expect(rejected.controller.submit(body, 'key-1', undefined, rejected.response))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    const conflict = createController(mock(async () => { throw new IdempotencyConflictError('key-1'); }));
    expect(conflict.controller.submit(body, 'key-1', undefined, conflict.response))
      .rejects.toBeInstanceOf(ConflictException);
  });

  test('requires idempotency key and a reference for reversals', async () => {
    const { controller, response } = createController(mock(async () => undefined));
    expect(controller.submit(body, undefined, undefined, response)).rejects.toBeInstanceOf(BadRequestException);
    expect(controller.submit({ ...body, kind: WagerTransactionKind.Refund }, 'key-1', undefined, response))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  test('maps a missing transaction to HTTP 404', async () => {
    const get = mock(async () => { throw new WagerTransactionNotFoundError('id'); });
    const { controller } = createController(mock(async () => undefined), get);
    expect(controller.getById('0192f298-345e-7e38-af88-e43f851a819d'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

function createController(
  process: (...args: never[]) => Promise<unknown>,
  get: (...args: never[]) => Promise<unknown> = mock(async () => undefined),
) {
  const status = mock(() => response);
  const response = { status } as unknown as Response;
  const controller = new WageringController(
    { execute: process } as unknown as ProcessWagerTransactionUseCase,
    { execute: get } as unknown as GetWagerTransactionUseCase,
  );
  return { controller, response, status };
}
