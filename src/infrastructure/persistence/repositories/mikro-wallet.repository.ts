import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../domain/money/money';
import { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletEntity } from '../entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

export class WalletConcurrencyError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} was modified concurrently`);
    this.name = 'WalletConcurrencyError';
  }
}

@Injectable()
export class MikroWalletRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.entityManager.findOne(WalletEntity, { id });

    return entity === null ? null : this.toDomain(entity);
  }

  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const entity = await this.entityManager.findOne(WalletEntity, {
      playerId,
      currency,
    });

    return entity === null ? null : this.toDomain(entity);
  }

  async save(
    wallet: Wallet,
    ledgerEntry?: WalletLedgerEntry,
  ): Promise<void> {
    await this.entityManager.transactional(async (entityManager) => {
      const existing = await entityManager.findOne(WalletEntity, {
        id: wallet.id,
      });

      if (existing === null) {
        entityManager.persist(
          entityManager.create(WalletEntity, this.toPersistence(wallet)),
        );
      } else if (existing.version !== wallet.version) {
        const affectedRows = await entityManager.nativeUpdate(
          WalletEntity,
          { id: wallet.id, version: wallet.version - 1 },
          {
            balance: wallet.balance.toString(),
            version: wallet.version,
            updatedAt: wallet.updatedAt,
          },
        );

        if (affectedRows !== 1) {
          throw new WalletConcurrencyError(wallet.id);
        }
      }

      if (ledgerEntry !== undefined) {
        entityManager.persist(
          entityManager.create(
            WalletLedgerEntryEntity,
            this.ledgerToPersistence(ledgerEntry),
          ),
        );
      }

      await entityManager.flush();
    });
  }

  private toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({
        amount: entity.balance,
        currency: entity.currency,
      }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  private toPersistence(wallet: Wallet) {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  private ledgerToPersistence(entry: WalletLedgerEntry) {
    return {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toString(),
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
    };
  }
}
