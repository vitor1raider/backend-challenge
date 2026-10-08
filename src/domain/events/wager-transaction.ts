import {
  IntegrationEvent,
  type EventContext,
} from './integration-event';
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../enums';
import { WagerTransaction } from '../wagering/wager-transaction';

export interface EventMoney {
  amount: string;
  currency: string;
}

interface WagerTransactionEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: EventMoney;
  referenceExternalTransactionId: string | undefined;
  referenceTransactionId: string | undefined;
}

export interface WagerTransactionProcessedData
  extends WagerTransactionEventData {
  status: WagerTransactionStatus.Processed;
  processedAt: string;
}

export interface WagerTransactionRejectedData
  extends WagerTransactionEventData {
  status: WagerTransactionStatus.Rejected;
  failureCode: FailureCode;
}

export interface WagerTransactionPendingReferenceData
  extends WagerTransactionEventData {
  status: WagerTransactionStatus.PendingReference;
  referenceExternalTransactionId: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  private constructor(
    transaction: WagerTransaction,
    context: EventContext,
    processedAt: Date,
  ) {
    super({
      eventId: context.eventId,
      aggregateId: transaction.id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined
        ? {}
        : { causationId: context.causationId }),
      occurredAt: context.occurredAt,
      data: Object.freeze({
        ...transactionData(transaction),
        status: WagerTransactionStatus.Processed,
        processedAt: processedAt.toISOString(),
      }),
    });
  }

  static create(
    transaction: WagerTransaction,
    context: EventContext,
    processedAt: Date,
  ): WagerTransactionProcessed {
    if (transaction.status !== WagerTransactionStatus.Processed) {
      throw new Error(
        'WagerTransactionProcessed requires a transaction with status Processed',
      );
    }

    return new WagerTransactionProcessed(transaction, context, processedAt);
  }

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionProcessed {
    if (
      transaction.status !== WagerTransactionStatus.Processed ||
      transaction.processedAt === undefined
    ) {
      throw new Error(
        'WagerTransactionProcessed requires a processed transaction',
      );
    }

    return new WagerTransactionProcessed(
      transaction,
      context,
      transaction.processedAt,
    );
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  private constructor(
    transaction: WagerTransaction,
    context: EventContext,
    failureCode: FailureCode,
  ) {
    super({
      eventId: context.eventId,
      aggregateId: transaction.id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined
        ? {}
        : { causationId: context.causationId }),
      occurredAt: context.occurredAt,
      data: Object.freeze({
        ...transactionData(transaction),
        status: WagerTransactionStatus.Rejected,
        failureCode,
      }),
    });
  }

  static create(
    transaction: WagerTransaction,
    context: EventContext,
    failureCode: FailureCode,
  ): WagerTransactionRejected {
    if (transaction.status !== WagerTransactionStatus.Rejected) {
      throw new Error(
        'WagerTransactionRejected requires a transaction with status Rejected',
      );
    }

    if (transaction.failureCode === undefined) {
      throw new Error(
        'WagerTransactionRejected requires a transaction with a failure code',
      );
    }

    return new WagerTransactionRejected(transaction, context, failureCode);
  }

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionRejected {
    if (
      transaction.status !== WagerTransactionStatus.Rejected ||
      transaction.failureCode === undefined
    ) {
      throw new Error(
        'WagerTransactionRejected requires a rejected transaction with a failure code',
      );
    }

    return new WagerTransactionRejected(
      transaction,
      context,
      transaction.failureCode,
    );
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  private constructor(
    transaction: WagerTransaction,
    context: EventContext,
    referenceExternalTransactionId: string,
  ) {
    super({
      eventId: context.eventId,
      aggregateId: transaction.id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined
        ? {}
        : { causationId: context.causationId }),
      occurredAt: context.occurredAt,
      data: Object.freeze({
        ...transactionData(transaction),
        status: WagerTransactionStatus.PendingReference,
        referenceExternalTransactionId,
      }),
    });
  }

  static create(
    transaction: WagerTransaction,
    context: EventContext,
    referenceExternalTransactionId: string,
  ): WagerTransactionPendingReference {
    if (transaction.status !== WagerTransactionStatus.PendingReference) {
      throw new Error(
        'WagerTransactionPendingReference requires a transaction with status PendingReference',
      );
    }

    if (transaction.referenceExternalTransactionId === undefined) {
      throw new Error(
        'WagerTransactionPendingReference requires a transaction with a reference external transaction ID',
      );
    }

    return new WagerTransactionPendingReference(
      transaction,
      context,
      referenceExternalTransactionId,
    );
  }

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    if (
      transaction.status !== WagerTransactionStatus.PendingReference ||
      transaction.referenceExternalTransactionId === undefined
    ) {
      throw new Error(
        'WagerTransactionPendingReference requires a transaction awaiting a reference',
      );
    }

    return new WagerTransactionPendingReference(
      transaction,
      context,
      transaction.referenceExternalTransactionId,
    );
  }
}

function transactionData(
  transaction: WagerTransaction,
): WagerTransactionEventData {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: Object.freeze(transaction.money.toJSON()),
    referenceExternalTransactionId:
      transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
  };
}
