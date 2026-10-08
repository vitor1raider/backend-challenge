import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../../src/application/wagering/process-wager-transaction.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/domain/enums';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/infrastructure/persistence/entities/wallet.entity';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const enabled = databaseUrl !== undefined && databaseUrl.trim().length > 0;
const it = enabled ? test : test.skip;
const schema = `application_test_${process.pid}_${Date.now()}`;
let orm: MikroORM;

describe('Application use cases (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!enabled) return;
    orm = await MikroORM.init({
      clientUrl: databaseUrl!,
      schema,
      entities: [WalletEntity, WalletLedgerEntryEntity, WagerTransactionEntity, InboxMessageEntity, OutboxMessageEntity],
    });
    await orm.em.getConnection().execute(`create schema if not exists "${schema}"`);
    await orm.schema.create();
  });

  beforeEach(async () => {
    if (!enabled) return;
    await orm.em.getConnection().execute(
      `truncate table "${schema}"."wallet_ledger_entries", "${schema}"."wager_transactions", "${schema}"."inbox_messages", "${schema}"."outbox_messages", "${schema}"."wallets" restart identity cascade`,
    );
  });

  afterAll(async () => {
    if (!enabled || orm === undefined) return;
    await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`);
    await orm.close(true);
  });

  it('creates the wallet, opening transaction, ledger and outbox atomically', async () => {
    const result = await new CreateWalletUseCase(orm.em).execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: randomUUID(),
    });

    expect(result.balance.amount).toBe('100.00');
    expect(result.version).toBe(1);
    expect(await orm.em.fork().count(WagerTransactionEntity, { kind: WagerTransactionKind.Opening })).toBe(1);
    expect(await orm.em.fork().count(WalletLedgerEntryEntity, { walletId: result.id })).toBe(1);
    expect(await orm.em.fork().count(OutboxMessageEntity, {})).toBe(2);
  });

  it('processes a wager and preserves its original balance on idempotent replay', async () => {
    const playerId = randomUUID();
    const wallet = await new CreateWalletUseCase(orm.em).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: randomUUID(),
    });
    const useCase = new ProcessWagerTransactionUseCase(orm.em);
    const base = {
      providerId: 'provider-a',
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
    } as const;
    const betCommand = {
      idempotencyKey: 'provider-a:bet-1',
      correlationId: randomUUID(),
      data: {
        ...base,
        externalTransactionId: 'bet-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
    } as const;

    const bet = await useCase.execute(betCommand);
    await useCase.execute({
      idempotencyKey: 'provider-a:win-1',
      correlationId: randomUUID(),
      data: {
        ...base,
        externalTransactionId: 'win-1',
        kind: WagerTransactionKind.Win,
        money: { amount: '10.00', currency: 'BRL' },
      },
    });
    const replay = await useCase.execute(betCommand);

    expect(bet.status).toBe(WagerTransactionStatus.Processed);
    expect(bet.balance?.amount).toBe('75.00');
    expect(replay.transactionId).toBe(bet.transactionId);
    expect(replay.balance?.amount).toBe('75.00');
    expect(replay.idempotentReplay).toBe(true);
    expect(await orm.em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(3);
  });

  it('processes two concurrent bets without allowing a negative balance', async () => {
    const playerId = randomUUID();
    const wallet = await new CreateWalletUseCase(orm.em).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: randomUUID(),
    });
    const useCase = new ProcessWagerTransactionUseCase(orm.em);
    const bet = (externalTransactionId: string) => useCase.execute({
      idempotencyKey: `provider-a:${externalTransactionId}`,
      correlationId: randomUUID(),
      data: {
        providerId: 'provider-a',
        externalTransactionId,
        playerId,
        walletId: wallet.id,
        roundId: 'round-concurrent',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '80.00', currency: 'BRL' },
      },
    });

    const results = await Promise.all([bet('bet-a'), bet('bet-b')]);
    const storedWallet = await orm.em.fork().findOneOrFail(WalletEntity, { id: wallet.id });

    expect(results.filter(({ status }) => status === WagerTransactionStatus.Processed)).toHaveLength(1);
    expect(results.filter(({ status }) => status === WagerTransactionStatus.Rejected)).toHaveLength(1);
    expect(storedWallet.balance).toBe('20.00');
    expect(await orm.em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
  });
});
