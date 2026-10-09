import Decimal from 'decimal.js';
import { expect } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LedgerDirection } from '../../../src/domain/enums';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';

export async function expectWalletBalanceToMatchLedger(
  entityManager: EntityManager,
  walletId: string,
): Promise<void> {
  const em = entityManager.fork();
  const wallet = await em.findOneOrFail(WalletEntity, { id: walletId });
  const entries = await em.find(
    WalletLedgerEntryEntity,
    { walletId },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
  );
  let reconstructed = new Decimal(0);

  for (const entry of entries) {
    expect(entry.currency).toBe(wallet.currency);
    expect(new Decimal(entry.amount).isPositive()).toBe(true);

    const expectedAfter = entry.direction === LedgerDirection.Credit
      ? new Decimal(entry.balanceBefore).plus(entry.amount)
      : new Decimal(entry.balanceBefore).minus(entry.amount);
    expect(new Decimal(entry.balanceAfter).equals(expectedAfter)).toBe(true);

    reconstructed = entry.direction === LedgerDirection.Credit
      ? reconstructed.plus(entry.amount)
      : reconstructed.minus(entry.amount);
  }

  expect(reconstructed.toFixed(2)).toBe(new Decimal(wallet.balance).toFixed(2));
}

export async function expectAllWalletBalancesToMatchLedger(
  entityManager: EntityManager,
): Promise<void> {
  const wallets = await entityManager.fork().find(WalletEntity, {});
  for (const wallet of wallets) {
    await expectWalletBalanceToMatchLedger(entityManager, wallet.id);
  }
}
