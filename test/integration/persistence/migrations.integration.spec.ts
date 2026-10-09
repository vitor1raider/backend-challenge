import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { IMigrator } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM } from '@mikro-orm/postgresql';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl?.trim());
const it = enabled ? test : test.skip;
const schema = `migration_test_${process.pid}_${Date.now()}`;
const migrationsPath = resolve(
  import.meta.dir,
  '../../../src/infrastructure/persistence/migrations',
);
const applicationTables = [
  'inbox_messages',
  'outbox_messages',
  'wager_transactions',
  'wallet_ledger_entries',
  'wallets',
];

let orm: MikroORM;
let migrator: IMigrator;

describe('Real database migrations', () => {
  beforeAll(async () => {
    if (!enabled) return;

    orm = await MikroORM.init({
      clientUrl: databaseUrl!,
      entities: [
        WalletEntity,
        WalletLedgerEntryEntity,
        WagerTransactionEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      extensions: [Migrator],
      migrations: {
        path: migrationsPath,
        pathTs: migrationsPath,
        emit: 'ts',
      },
    });
    await orm.em.getConnection().execute(`create schema "${schema}"`);
    migrator = orm.migrator;
  });

  afterAll(async () => {
    if (!enabled || orm === undefined) return;
    await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`);
    await orm.close(true);
  });

  it('applies, validates, rolls back and reapplies the real migrations', async () => {
    const pending = await migrator.getPending({ schema });
    expect(pending.map(({ name }) => name)).toEqual([
      'Migration20261008115319',
    ]);

    const applied = await migrator.up({ schema });
    expect(applied.map(({ name }) => name)).toEqual([
      'Migration20261008115319',
    ]);
    await expectMigratedSchema();

    const executed = await migrator.getExecuted({ schema });
    expect(executed.map(({ name }) => name)).toEqual([
      'Migration20261008115319',
    ]);

    await migrator.down({ schema });
    expect(await findApplicationTables()).toEqual([]);

    await migrator.up({ schema });
    await expectMigratedSchema();
  });
});

async function expectMigratedSchema(): Promise<void> {
  expect(await findApplicationTables()).toEqual(applicationTables);

  const indexes = await orm.em.getConnection().execute<
    Array<{ indexname: string; indexdef: string }>
  >(
    `select indexname, indexdef
       from pg_indexes
      where schemaname = ?`,
    [schema],
  );
  const indexDefinitions = new Map(
    indexes.map(({ indexname, indexdef }) => [indexname, indexdef]),
  );
  expect(indexDefinitions.get('ledger_wallet_created_id_idx')).toContain(
    '(wallet_id, created_at, id)',
  );
  expect(indexDefinitions.get('wager_pending_reference_due_idx')).toContain(
    '(status, next_reference_attempt, created_at)',
  );
  expect(indexDefinitions.get('wager_reference_reversal_idx')).toContain(
    '(reference_transaction_id, kind, status)',
  );
  expect(indexDefinitions.get('outbox_pending_due_idx')).toContain(
    'WHERE (published_at IS NULL)',
  );

  const constraints = await orm.em.getConnection().execute<
    Array<{ conname: string; definition: string }>
  >(
    `select constraint_name as conname,
            pg_get_constraintdef(pg_constraint.oid) as definition
       from information_schema.table_constraints
       join pg_constraint on pg_constraint.conname = constraint_name
       join pg_namespace on pg_namespace.oid = pg_constraint.connamespace
      where constraint_schema = ?
        and pg_namespace.nspname = ?`,
    [schema, schema],
  );
  const constraintDefinitions = new Map(
    constraints.map(({ conname, definition }) => [conname, definition]),
  );
  expect(constraintDefinitions.get('wallets_balance_check')).toContain(
    'balance >=',
  );
  expect(constraintDefinitions.get('wallets_version_check')).toContain(
    'version >=',
  );
  expect(constraintDefinitions.get('ledger_wallet_transaction_unique')).toBe(
    'UNIQUE (wallet_id, transaction_id)',
  );
  expect(constraintDefinitions.get('wager_provider_external_unique')).toBe(
    'UNIQUE (provider_id, external_transaction_id)',
  );
  expect(constraintDefinitions.get('wager_transactions_kind_check')).toContain(
    "'ROLLBACK'",
  );
  expect(constraintDefinitions.get('wager_transactions_status_check')).toContain(
    "'PENDING_REFERENCE'",
  );
}

async function findApplicationTables(): Promise<string[]> {
  const rows = await orm.em.getConnection().execute<Array<{ table_name: string }>>(
    `select table_name
       from information_schema.tables
      where table_schema = ?
      order by table_name`,
    [schema],
  );
  return rows
    .map(({ table_name }) => table_name)
    .filter((tableName) => applicationTables.includes(tableName));
}
