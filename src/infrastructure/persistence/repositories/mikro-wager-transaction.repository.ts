import { Injectable } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { FailureCode, WagerTransactionKind, WagerTransactionStatus } from '../../../domain/enums';
import { Money } from '../../../domain/money/money';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

@Injectable()
export class MikroWagerTransactionRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    return this.findOne({ id });
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    return this.findOne({ idempotencyKey });
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.findOne({ providerId, externalTransactionId });
  }

  async hasProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  ): Promise<boolean> {
    return (
      (await this.entityManager.count(WagerTransactionEntity, {
        referenceTransactionId,
        kind,
        status: WagerTransactionStatus.Processed,
      })) > 0
    );
  }

  async findPendingReferencesDueForUpdate(now: Date, limit = 100): Promise<WagerTransaction[]> {
    const entities = await this.entityManager.find(
      WagerTransactionEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        nextReferenceAttempt: { $lte: now },
      },
      {
        limit,
        orderBy: { nextReferenceAttempt: 'asc', createdAt: 'asc' },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
    return entities.map((entity) => this.toDomain(entity));
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const existing = await this.entityManager.findOne(
      WagerTransactionEntity,
      { id: transaction.id },
    );
    const data = this.toPersistence(transaction);

    if (existing === null) {
      this.entityManager.persist(
        this.entityManager.create(WagerTransactionEntity, data),
      );
    } else {
      this.entityManager.assign(existing, data);
    }

    await this.entityManager.flush();
  }

  private async findOne(
    where: Partial<Pick<WagerTransactionEntity, 'id' | 'idempotencyKey' | 'providerId' | 'externalTransactionId'>>,
  ): Promise<WagerTransaction | null> {
    const entity = await this.entityManager.findOne(
      WagerTransactionEntity,
      where,
    );

    return entity === null ? null : this.toDomain(entity);
  }

  private toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.from({ amount: entity.amount, currency: entity.currency }),
      referenceExternalTransactionId:
        entity.referenceExternalTransactionId ?? undefined,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId ?? undefined,
      failureCode: (entity.failureCode as FailureCode | null) ?? undefined,
      processedAt: entity.processedAt ?? undefined,
      resultBalance:
        entity.resultBalance == null
          ? undefined
          : Money.from({ amount: entity.resultBalance, currency: entity.currency }),
      referenceAttempts: entity.referenceAttempts,
      nextReferenceAttempt: entity.nextReferenceAttempt ?? undefined,
      referenceExpiresAt: entity.referenceExpiresAt ?? undefined,
    });
  }

  private toPersistence(transaction: WagerTransaction) {
    return {
      id: transaction.id,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: transaction.status,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      processedAt: transaction.processedAt ?? null,
      resultBalance: transaction.resultBalance?.toString() ?? null,
      referenceAttempts: transaction.referenceAttempts,
      nextReferenceAttempt: transaction.nextReferenceAttempt ?? null,
      referenceExpiresAt: transaction.referenceExpiresAt ?? null,
      createdAt: transaction.createdAt,
      updatedAt: transaction.processedAt ?? transaction.createdAt,
    };
  }
}
