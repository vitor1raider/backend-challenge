import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { InboxMessageEntity } from './src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from './src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from './src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from './src/infrastructure/persistence/entities/wallet.entity';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export default defineConfig({
  clientUrl: databaseUrl,
  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    OutboxMessageEntity,
    InboxMessageEntity,
  ],
  extensions: [Migrator],

  migrations: {
    path: './dist/infrastructure/persistence/migrations',
    pathTs: './src/infrastructure/persistence/migrations',
    emit: 'ts',
  },
});
