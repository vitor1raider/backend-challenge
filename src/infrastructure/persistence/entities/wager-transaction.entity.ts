import { defineEntity, p } from '@mikro-orm/postgresql';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/enums';

const WagerTransactionSchema = defineEntity({
  name: 'WagerTransactionEntity',
  tableName: 'wager_transactions',
  properties: {
    id: p.string().type('uuid').primary(),
    walletId: p.string().type('uuid').fieldName('wallet_id'),
    playerId: p.string().type('uuid').fieldName('player_id'),
    providerId: p.string().fieldName('provider_id'),
    externalTransactionId: p.string().fieldName('external_transaction_id'),
    idempotencyKey: p.string().fieldName('idempotency_key').unique(),
    payloadHash: p.string().fieldName('payload_hash'),
    roundId: p.string().fieldName('round_id'),
    gameId: p.string().fieldName('game_id'),
    kind: p.enum(WagerTransactionKind),
    status: p.enum(WagerTransactionStatus),
    amount: p.decimal('string').precision(15).scale(2),
    currency: p.string().length(3),
    referenceExternalTransactionId: p
      .string()
      .fieldName('reference_external_transaction_id')
      .nullable(),
    referenceTransactionId: p
      .string()
      .type('uuid')
      .fieldName('reference_transaction_id')
      .nullable(),
    failureCode: p.string().fieldName('failure_code').nullable(),
    resultBalance: p
      .decimal('string')
      .precision(15)
      .scale(2)
      .fieldName('result_balance')
      .nullable(),
    referenceAttempts: p
      .integer()
      .default(0)
      .check('reference_attempts >= 0')
      .fieldName('reference_attempts'),
    nextReferenceAttempt: p
      .datetime()
      .fieldName('next_reference_attempt')
      .nullable(),
    referenceExpiresAt: p
      .datetime()
      .fieldName('reference_expires_at')
      .nullable(),
    processedAt: p.datetime().fieldName('processed_at').nullable(),
    createdAt: p.datetime().fieldName('created_at'),
    updatedAt: p.datetime().fieldName('updated_at'),
  },
  uniques: [
    {
      name: 'wager_provider_external_unique',
      properties: ['providerId', 'externalTransactionId'],
    },
  ],
  indexes: [
    {
      name: 'wager_pending_reference_due_idx',
      properties: ['status', 'nextReferenceAttempt', 'createdAt'],
    },
    {
      name: 'wager_reference_reversal_idx',
      properties: ['referenceTransactionId', 'kind', 'status'],
    },
  ],
});

export class WagerTransactionEntity extends WagerTransactionSchema.class {}
WagerTransactionSchema.setClass(WagerTransactionEntity);
