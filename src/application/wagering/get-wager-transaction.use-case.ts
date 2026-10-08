import { Injectable } from '@nestjs/common';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction';
import { MikroWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-wager-transaction.repository';

export class WagerTransactionNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Transação ${identifier} não encontrada`);
    this.name = 'WagerTransactionNotFoundError';
  }
}

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(private readonly wagers: MikroWagerTransactionRepository) {}

  async execute(transactionId: string) {
    const transaction = await this.wagers.findById(transactionId);
    if (transaction === null) throw new WagerTransactionNotFoundError(transactionId);
    return wagerResult(transaction);
  }
}

@Injectable()
export class GetProviderWagerTransactionUseCase {
  constructor(private readonly wagers: MikroWagerTransactionRepository) {}

  async execute(providerId: string, externalTransactionId: string) {
    const transaction = await this.wagers.findByExternalTransactionId(providerId, externalTransactionId);
    if (transaction === null) throw new WagerTransactionNotFoundError(`${providerId}/${externalTransactionId}`);
    return wagerResult(transaction);
  }
}

function wagerResult(transaction: WagerTransaction) {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    status: transaction.status,
    money: transaction.money.toJSON(),
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    failureCode: transaction.failureCode,
    resultBalance: transaction.resultBalance?.toJSON(),
    processedAt: transaction.processedAt?.toISOString(),
    createdAt: transaction.createdAt.toISOString(),
  };
}
