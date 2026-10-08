import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { WalletEntity } from './entities/wallet.entity';
import { MikroInboxMessageRepository } from './repositories/mikro-inbox-message.repository';
import { MikroOutboxRepository } from './repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from './repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from './repositories/mikro-wallet.repository';

const entities = [
  WalletEntity,
  WalletLedgerEntryEntity,
  WagerTransactionEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];

const repositories = [
  MikroWalletRepository,
  MikroWagerTransactionRepository,
  MikroInboxMessageRepository,
  MikroOutboxRepository,
];

@Module({
  imports: [MikroOrmModule.forFeature(entities)],
  providers: repositories,
  exports: repositories,
})
export class PersistenceModule {}
