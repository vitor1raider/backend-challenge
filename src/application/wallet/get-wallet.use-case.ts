import { Injectable } from '@nestjs/common';
import { MikroWalletRepository } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';
import type { WalletResult } from './create-wallet.use-case';

export class WalletNotFoundError extends Error {
  constructor(id: string) {
    super(`Wallet ${id} não encontrada`);
    this.name = 'WalletNotFoundError';
  }
}

@Injectable()
export class GetWalletUseCase {
  constructor(private readonly wallets: MikroWalletRepository) {}

  async execute(walletId: string): Promise<WalletResult> {
    const wallet = await this.wallets.findById(walletId);
    if (wallet === null) throw new WalletNotFoundError(walletId);
    return { id: wallet.id, playerId: wallet.playerId, balance: wallet.balance.toJSON(), version: wallet.version };
  }
}
