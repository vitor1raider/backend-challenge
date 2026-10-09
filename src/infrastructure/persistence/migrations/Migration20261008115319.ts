import { Migration } from '@mikro-orm/migrations';

export class Migration20261008115319 extends Migration {

  override name = 'Migration20261008115319';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("message_id" varchar(255) not null, "consumer_name" varchar(255) not null, "payload_hash" varchar(255) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("message_id", "consumer_name"));`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(255) not null, "payload" jsonb not null, "attempts" int not null, "occurred_at" timestamptz not null, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "outbox_pending_due_idx" on "outbox_messages" ("next_attempt_at", "occurred_at") where published_at is null;`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "wallet_id" uuid not null, "player_id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "kind" text not null, "status" text not null, "amount" numeric(15,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "reference_transaction_id" uuid null, "failure_code" varchar(255) null, "result_balance" numeric(15,2) null, "reference_attempts" int not null default 0, "next_reference_attempt" timestamptz null, "reference_expires_at" timestamptz null, "processed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_provider_external_unique" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`create index "wager_pending_reference_due_idx" on "wager_transactions" ("status", "next_reference_attempt", "created_at");`);
    this.addSql(`create index "wager_reference_reversal_idx" on "wager_transactions" ("reference_transaction_id", "kind", "status");`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance" numeric(15,2) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "amount" numeric(15,2) not null, "currency" varchar(3) not null, "balance_before" numeric(15,2) not null, "balance_after" numeric(15,2) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_wallet_transaction_unique" unique ("wallet_id", "transaction_id");`);
    this.addSql(`create index "ledger_wallet_created_id_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_attempts_check" check (reference_attempts >= 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_check" check (balance >= 0);`);
    this.addSql(`alter table "wallets" add constraint "wallets_version_check" check (version >= 1);`);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_before_check" check (balance_before >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_after_check" check (balance_after >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }

}
