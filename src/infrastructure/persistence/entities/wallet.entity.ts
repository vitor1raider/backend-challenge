import { defineEntity, p } from '@mikro-orm/postgresql';

const WalletSchema = defineEntity({
  name: 'WalletEntity',
  tableName: 'wallets',
  properties: {
    id: p.string().type('uuid').primary(),
    playerId: p.string().type('uuid').fieldName('player_id'),
    currency: p.string().length(3),
    balance: p
      .decimal('string')
      .precision(15)
      .scale(2)
      .check('balance >= 0'),
    version: p.integer().default(1).check('version >= 1'),
    createdAt: p.datetime().fieldName('created_at'),
    updatedAt: p.datetime().fieldName('updated_at'),
  },
  uniques: [{ properties: ['playerId', 'currency'] }],
});

export class WalletEntity extends WalletSchema.class {}
WalletSchema.setClass(WalletEntity);
