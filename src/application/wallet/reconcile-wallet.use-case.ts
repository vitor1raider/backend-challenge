import Decimal from 'decimal.js';
import { Injectable } from '@nestjs/common';
import { LedgerDirection } from '../../domain/enums';
import { MikroWalletRepository } from '../../infrastructure/persistence/repositories/mikro-wallet.repository';
import { Observability } from '../../infrastructure/observability/observability';
import { WalletNotFoundError } from './get-wallet.use-case';

@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    private readonly wallets: MikroWalletRepository,
    private readonly observability: Observability,
  ) {}

  async execute(walletId: string) {
    const wallet = await this.wallets.findById(walletId);
    if (wallet === null) throw new WalletNotFoundError(walletId);
    const entries = await this.wallets.findAllLedgerEntries(walletId);
    const calculated = entries.reduce(
      (balance, entry) => entry.direction === LedgerDirection.Credit
        ? balance.plus(entry.money.toString())
        : balance.minus(entry.money.toString()),
      new Decimal(0),
    );
    const stored = new Decimal(wallet.balance.toString());
    const difference = stored.minus(calculated);
    const consistent = difference.isZero();
    if (!consistent) {
      this.observability.reportWarning(ReconcileWalletUseCase.name, 'divergencia_saldo', new Error('Saldo divergente'), {
        walletId,
      });
    }
    const money = (amount: Decimal) => ({ amount: amount.toFixed(2), currency: wallet.currency });
    return {
      walletId,
      storedBalance: money(stored),
      calculatedBalance: money(calculated),
      difference: money(difference),
      consistent,
      checkedEntries: entries.length,
    };
  }
}
