import { defineEntity, p } from '@mikro-orm/postgresql';
import { LedgerDirection } from '../../../domain/enums/ledger-direction';

export const WalletLedgerEntrySchema = defineEntity({
  name: 'WalletLedgerEntryEntity',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: p.string().type('uuid').primary(),
    walletId: p.string().type('uuid').fieldName('wallet_id'),
    transactionId: p.string().type('uuid').fieldName('transaction_id'),
    direction: p.enum(LedgerDirection),
    amount: p.decimal('string').precision(15).scale(2),
    currency: p.string().length(3),
    balanceBefore: p
      .decimal('string')
      .precision(15)
      .scale(2)
      .check('balance_before >= 0')
      .fieldName('balance_before'),
    balanceAfter: p
      .decimal('string')
      .precision(15)
      .scale(2)
      .check('balance_after >= 0')
      .fieldName('balance_after'),
    createdAt: p.datetime().fieldName('created_at'),
  },
  uniques: [
    {
      name: 'ledger_wallet_transaction_unique',
      properties: ['walletId', 'transactionId'],
    },
  ],
  indexes: [
    {
      name: 'ledger_wallet_created_id_idx',
      properties: ['walletId', 'createdAt', 'id'],
    },
  ],
});

export class WalletLedgerEntryEntity extends WalletLedgerEntrySchema.class {}
WalletLedgerEntrySchema.setClass(WalletLedgerEntryEntity);
