import { MikroORM } from '@mikro-orm/postgresql';
import { ProcessWagerTransactionUseCase } from '../../../src/application/wagering/process-wager-transaction.use-case';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';
import { MikroUnitOfWork } from '../../../src/infrastructure/persistence/mikro-unit-of-work';

interface WorkerInput {
  readonly databaseUrl: string;
  readonly schema: string;
  readonly startAt: number;
  readonly command: Parameters<ProcessWagerTransactionUseCase['execute']>[0];
}

const serializedInput = process.argv[2];
if (serializedInput === undefined) throw new Error('Worker input is required');

const input = JSON.parse(serializedInput) as WorkerInput;
const orm = await MikroORM.init({
  clientUrl: input.databaseUrl,
  schema: input.schema,
  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
});

try {
  const waitMilliseconds = Math.max(0, input.startAt - Date.now());
  if (waitMilliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
  }

  const result = await new ProcessWagerTransactionUseCase(
    new MikroUnitOfWork(orm.em),
  ).execute(input.command);
  process.stdout.write(JSON.stringify(result));
} finally {
  await orm.close(true);
}
