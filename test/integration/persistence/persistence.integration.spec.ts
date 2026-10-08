import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { InboxMessage } from '../../../src/domain/inbox/inbox-message';
import { Money } from '../../../src/domain/money/money';
import { OutboxMessage } from '../../../src/domain/outbox/outbox-message';
import { Wallet } from '../../../src/domain/wallet/wallet';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';
import {
  InboxPayloadConflictError,
  MikroInboxMessageRepository,
} from '../../../src/infrastructure/persistence/repositories/mikro-inbox-message.repository';
import { MikroOutboxRepository } from '../../../src/infrastructure/persistence/repositories/mikro-outbox.repository';
import {
  MikroWalletRepository,
  WalletConcurrencyError,
} from '../../../src/infrastructure/persistence/repositories/mikro-wallet.repository';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const hasDatabaseUrl =
  databaseUrl !== undefined && databaseUrl.trim().length > 0;
const it = hasDatabaseUrl ? test : test.skip;
const testSchema = `persistence_test_${process.pid}_${Date.now()}`;

let orm: MikroORM;

describe('Persistence integration (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!hasDatabaseUrl) return;

    orm = await MikroORM.init({
      clientUrl: databaseUrl!,
      schema: testSchema,
      entities: [
        WalletEntity,
        WalletLedgerEntryEntity,
        WagerTransactionEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
    });

    await orm.em
      .getConnection()
      .execute(`create schema if not exists "${testSchema}"`);
    await orm.schema.create();
  });

  beforeEach(async () => {
    if (!hasDatabaseUrl) return;

    await orm.em.getConnection().execute(
      `truncate table
        "${testSchema}"."wallet_ledger_entries",
        "${testSchema}"."wager_transactions",
        "${testSchema}"."inbox_messages",
        "${testSchema}"."outbox_messages",
       "${testSchema}"."wallets"
       restart identity cascade`,
    );
  });

  afterAll(async () => {
    if (!hasDatabaseUrl || orm === undefined) return;

    await orm.em
      .getConnection()
      .execute(`drop schema if exists "${testSchema}" cascade`);
    await orm.close(true);
  });

  it(
    'creates the persistence indexes required by the queries',
    async () => {
      const rows = await orm.em
        .getConnection()
        .execute<Array<{ indexname: string; indexdef: string }>>(
          `select indexname, indexdef
         from pg_indexes
        where schemaname = ?`,
          [testSchema],
        );

      const indexes = new Map(
        rows.map(({ indexname, indexdef }) => [indexname, indexdef]),
      );

      expect(indexes.has('ledger_wallet_created_id_idx')).toBe(true);
      expect(indexes.has('wager_pending_reference_due_idx')).toBe(true);
      expect(indexes.has('wager_reference_reversal_idx')).toBe(true);
      expect(indexes.get('outbox_pending_due_idx')).toContain(
        'WHERE (published_at IS NULL)',
      );
    },
  );

  it(
    'enforces wallet uniqueness and non-negative balance in PostgreSQL',
    async () => {
      const playerId = randomUUID();
      const first = walletRow({ playerId });

      await orm.em.fork().insert(WalletEntity, first);

      await expect(
        orm.em.fork().insert(WalletEntity, {
          ...walletRow({ playerId }),
          currency: first.currency,
        }),
      ).rejects.toThrow();

      await expect(
        orm.em.fork().insert(WalletEntity, walletRow({ balance: '-0.01' })),
      ).rejects.toThrow();
    },
  );

  it(
    'persists and rehydrates a wallet together with its ledger entry',
    async () => {
      const em = orm.em.fork();
      const repository = new MikroWalletRepository(em);
      const wallet = Wallet.open({
        id: randomUUID(),
        playerId: randomUUID(),
        initialBalance: money('100.00'),
      });

      await repository.save(wallet);

      const entry = wallet.debit({
        id: randomUUID(),
        transactionId: randomUUID(),
        money: money('25.00'),
        at: new Date(),
      });
      await repository.save(wallet, entry);

      em.clear();
      const persisted = await repository.findById(wallet.id);
      const ledgerCount = await em.count(WalletLedgerEntryEntity, {
        walletId: wallet.id,
      });

      expect(persisted?.balance.toString()).toBe('75.00');
      expect(persisted?.version).toBe(2);
      expect(ledgerCount).toBe(1);
    },
  );

  it(
    'rolls back the wallet update when its ledger insert fails',
    async () => {
      const em = orm.em.fork();
      const repository = new MikroWalletRepository(em);
      const wallet = Wallet.open({
        id: randomUUID(),
        playerId: randomUUID(),
        initialBalance: money('100.00'),
      });
      await repository.save(wallet);

      const transactionId = randomUUID();
      const firstEntry = wallet.debit({
        id: randomUUID(),
        transactionId,
        money: money('10.00'),
        at: new Date(),
      });
      await repository.save(wallet, firstEntry);

      const duplicateEntry = wallet.debit({
        id: randomUUID(),
        transactionId,
        money: money('10.00'),
        at: new Date(Date.now() + 1_000),
      });
      await expect(repository.save(wallet, duplicateEntry)).rejects.toThrow();

      const verificationEm = orm.em.fork();
      const persisted = await new MikroWalletRepository(
        verificationEm,
      ).findById(wallet.id);

      expect(persisted?.balance.toString()).toBe('90.00');
      expect(persisted?.version).toBe(2);
      expect(
        await verificationEm.count(WalletLedgerEntryEntity, {
          walletId: wallet.id,
        }),
      ).toBe(1);
    },
  );

  it(
    'allows only one concurrent update for the same wallet version',
    async () => {
      const setupRepository = new MikroWalletRepository(orm.em.fork());
      const wallet = Wallet.open({
        id: randomUUID(),
        playerId: randomUUID(),
        initialBalance: money('100.00'),
      });
      await setupRepository.save(wallet);

      const firstRepository = new MikroWalletRepository(orm.em.fork());
      const secondRepository = new MikroWalletRepository(orm.em.fork());
      const first = await firstRepository.findById(wallet.id);
      const second = await secondRepository.findById(wallet.id);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();

      const firstEntry = first!.debit({
        id: randomUUID(),
        transactionId: randomUUID(),
        money: money('80.00'),
        at: new Date(),
      });
      const secondEntry = second!.debit({
        id: randomUUID(),
        transactionId: randomUUID(),
        money: money('80.00'),
        at: new Date(),
      });

      const results = await Promise.allSettled([
        firstRepository.save(first!, firstEntry),
        secondRepository.save(second!, secondEntry),
      ]);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(WalletConcurrencyError);

      const verificationEm = orm.em.fork();
      const persisted = await new MikroWalletRepository(
        verificationEm,
      ).findById(wallet.id);
      expect(persisted?.balance.toString()).toBe('20.00');
      expect(
        await verificationEm.count(WalletLedgerEntryEntity, {
          walletId: wallet.id,
        }),
      ).toBe(1);
    },
  );

  it(
    'deduplicates inbox messages by consumer and message id',
    async () => {
      const repository = new MikroInboxMessageRepository(orm.em.fork());
      const receivedAt = new Date();
      const message = InboxMessage.receive({
        messageId: 'message-1',
        consumerName: 'wager-consumer',
        payloadHash: 'hash-1',
        receivedAt,
      });
      await repository.save(message);

      await expect(
        new MikroInboxMessageRepository(orm.em.fork()).save(
          InboxMessage.receive({
            messageId: 'message-1',
            consumerName: 'wager-consumer',
            payloadHash: 'hash-2',
            receivedAt,
          }),
        ),
      ).rejects.toBeInstanceOf(InboxPayloadConflictError);

      expect(await repository.exists('message-1', 'wager-consumer')).toBe(true);
    },
  );

  it(
    'returns only due and unpublished outbox messages',
    async () => {
      const repository = new MikroOutboxRepository(orm.em.fork());
      const now = new Date();
      const due = outboxMessage({
        occurredAt: new Date(now.getTime() - 2_000),
      });
      const delayed = outboxMessage({
        occurredAt: new Date(now.getTime() - 1_000),
      });
      delayed.scheduleRetry(now);
      const published = outboxMessage({ occurredAt: now });
      published.markPublished(now);

      await repository.save(due);
      await repository.save(delayed);
      await repository.save(published);

      const messages = await repository.findDue(now);

      expect(messages.map((message) => message.id)).toEqual([due.id]);
    },
  );
});

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function walletRow(
  overrides: Partial<{
    playerId: string;
    balance: string;
  }> = {},
) {
  const now = new Date();

  return {
    id: randomUUID(),
    playerId: overrides.playerId ?? randomUUID(),
    currency: 'BRL',
    balance: overrides.balance ?? '100.00',
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function outboxMessage(props: { occurredAt: Date }): OutboxMessage {
  const id = randomUUID();

  return OutboxMessage.rehydrate({
    id,
    aggregateId: randomUUID(),
    eventType: 'PersistenceIntegrationTest',
    payload: { eventId: id },
    occurredAt: props.occurredAt,
    attempts: 0,
    nextAttemptAt: undefined,
    publishedAt: undefined,
  });
}
