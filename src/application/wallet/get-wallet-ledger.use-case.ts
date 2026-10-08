import { Injectable } from '@nestjs/common';
import { MikroWalletRepository } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';
import { WalletNotFoundError } from './get-wallet.use-case';

export interface LedgerPageQuery { readonly walletId: string; readonly cursor?: string; readonly limit?: number }

export class InvalidLedgerCursorError extends Error {
  constructor() {
    super('Cursor de ledger inválido');
    this.name = 'InvalidLedgerCursorError';
  }
}

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(private readonly wallets: MikroWalletRepository) {}

  async execute(query: LedgerPageQuery) {
    if (await this.wallets.findById(query.walletId) === null) throw new WalletNotFoundError(query.walletId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const entries = await this.wallets.findLedgerPage(query.walletId, limit + 1, decodeCursor(query.cursor));
    const hasNextPage = entries.length > limit;
    const items = entries.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: hasNextPage && last !== undefined
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
        : undefined,
    };
  }
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    const createdAt = new Date(String(value.createdAt));
    if (typeof value.id !== 'string' || value.id.length === 0 || Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: value.id };
  } catch {
    throw new InvalidLedgerCursorError();
  }
}
