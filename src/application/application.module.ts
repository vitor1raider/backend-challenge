import { Module } from '@nestjs/common';
import { Observability } from '../infrastructure/observability/observability';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { CreateWalletUseCase } from './wallet/create-wallet.use-case';
import { GetWalletUseCase } from './wallet/get-wallet.use-case';
import { GetWalletLedgerUseCase } from './wallet/get-wallet-ledger.use-case';
import { ReconcileWalletUseCase } from './wallet/reconcile-wallet.use-case';
import { GetProviderWagerTransactionUseCase, GetWagerTransactionUseCase } from './wagering/get-wager-transaction.use-case';
import { ProcessWagerTransactionUseCase } from './wagering/process-wager-transaction.use-case';
import { ReprocessPendingReferencesUseCase } from './wagering/reprocess-pending-references.use-case';

const useCases = [
  CreateWalletUseCase,
  GetWalletUseCase,
  GetWalletLedgerUseCase,
  ReconcileWalletUseCase,
  GetWagerTransactionUseCase,
  GetProviderWagerTransactionUseCase,
  ProcessWagerTransactionUseCase,
  ReprocessPendingReferencesUseCase,
];

@Module({
  imports: [PersistenceModule],
  providers: [Observability, ...useCases],
  exports: useCases,
})
export class ApplicationModule {}
