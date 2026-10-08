import type { Money } from '../money/money';
import {
  FailureCode,
  LedgerDirection,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../enums';

export {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../enums';

export class InvalidTransactionStateError extends Error {
  constructor(
    currentStatus: WagerTransactionStatus,
    targetStatus: WagerTransactionStatus,
  ) {
    super(`Transição inválida de ${currentStatus} para ${targetStatus}`);
    this.name = 'InvalidTransactionStateError';
  }
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  resultBalance: Money | undefined;
  referenceAttempts?: number;
  nextReferenceAttempt?: Date | undefined;
  referenceExpiresAt?: Date | undefined;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _resultBalance?: Money,
    private _referenceAttempts = 0,
    private _nextReferenceAttempt?: Date,
    private _referenceExpiresAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiresReference =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    const referenceExternalTransactionId = props.referenceExternalTransactionId;
    const hasValidReference =
      referenceExternalTransactionId !== undefined &&
      referenceExternalTransactionId.length > 0 &&
      referenceExternalTransactionId === referenceExternalTransactionId.trim();

    if (requiresReference && !hasValidReference) {
      throw new Error(`${props.kind} exige referenceExternalTransactionId`);
    }

    if (
      props.referenceExternalTransactionId !== undefined &&
      !hasValidReference
    ) {
      throw new Error('referenceExternalTransactionId não pode ser vazio');
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      referenceExternalTransactionId,
      new Date(props.createdAt.getTime()),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      new Date(state.createdAt.getTime()),
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt === undefined
        ? undefined
        : new Date(state.processedAt.getTime()),
      state.resultBalance,
      state.referenceAttempts ?? 0,
      state.nextReferenceAttempt,
      state.referenceExpiresAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }
  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }
  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }
  get processedAt(): Date | undefined {
    return this._processedAt;
  }
  get resultBalance(): Money | undefined {
    return this._resultBalance;
  }
  get referenceAttempts(): number { return this._referenceAttempts; }
  get nextReferenceAttempt(): Date | undefined {
    return this._nextReferenceAttempt === undefined ? undefined : new Date(this._nextReferenceAttempt);
  }
  get referenceExpiresAt(): Date | undefined {
    return this._referenceExpiresAt === undefined ? undefined : new Date(this._referenceExpiresAt);
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    resultBalance?: Money,
  ): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Processed);

    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      throw new Error('A data de processamento é inválida');
    }

    const hasExternalReference =
      this.referenceExternalTransactionId !== undefined;
    const hasResolvedReference =
      referenceTransactionId !== undefined &&
      referenceTransactionId.length > 0 &&
      referenceTransactionId === referenceTransactionId.trim();

    if (hasExternalReference !== hasResolvedReference) {
      throw new Error(
        'A referência interna deve corresponder à referência externa informada',
      );
    }

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = new Date(at.getTime());
    this._resultBalance = resultBalance;
  }

  markPendingReference(): void {
    this.assertCanTransitionTo(WagerTransactionStatus.PendingReference);

    if (this.referenceExternalTransactionId === undefined) {
      throw new Error(
        'Somente transações com referência podem aguardar resolução',
      );
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  scheduleReferenceRetry(now: Date, ttlMilliseconds = 86_400_000): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new Error('Somente uma transação com referência pendente pode ser reagendada');
    }
    this._referenceAttempts += 1;
    const delay = Math.min(5_000 * 2 ** (this._referenceAttempts - 1), 3_600_000);
    this._nextReferenceAttempt = new Date(now.getTime() + delay);
    this._referenceExpiresAt ??= new Date(this.createdAt.getTime() + ttlMilliseconds);
  }

  isReferenceExpired(at: Date): boolean {
    return this._referenceExpiresAt !== undefined && this._referenceExpiresAt.getTime() <= at.getTime();
  }

  reject(code: FailureCode, resultBalance?: Money): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Rejected);
    this._failureCode = code;
    this._status = WagerTransactionStatus.Rejected;
    this._resultBalance = resultBalance;
  }

  fail(code: FailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Failed);
    this._failureCode = code;
    this._status = WagerTransactionStatus.Failed;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
        if (this.kind === WagerTransactionKind.Win && reference !== undefined) {
          this.assertValidReference(
            reference,
            [WagerTransactionKind.Bet],
            false,
          );
        }
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Refund:
        this.assertValidReference(
          reference,
          [WagerTransactionKind.Bet],
          true,
        );
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback:
        this.assertValidReference(reference, [
          WagerTransactionKind.Bet,
          WagerTransactionKind.Win,
          WagerTransactionKind.Refund,
        ], true);
        return reference.kind === WagerTransactionKind.Bet
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;

      case WagerTransactionKind.Loss:
        throw new Error('LOSS não gera lançamento no ledger');
    }
  }

  private assertCanTransitionTo(target: WagerTransactionStatus): void {
    const isAllowed =
      (this._status === WagerTransactionStatus.Pending &&
        (target === WagerTransactionStatus.Processed ||
          target === WagerTransactionStatus.PendingReference ||
          target === WagerTransactionStatus.Rejected ||
          target === WagerTransactionStatus.Failed)) ||
      (this._status === WagerTransactionStatus.PendingReference &&
        (target === WagerTransactionStatus.Processed ||
          target === WagerTransactionStatus.Rejected ||
          target === WagerTransactionStatus.Failed));

    if (!isAllowed) {
      throw new InvalidTransactionStateError(this._status, target);
    }
  }

  private assertValidReference(
    reference: WagerTransaction | undefined,
    allowedKinds: readonly WagerTransactionKind[],
    requiresSameAmount: boolean,
  ): asserts reference is WagerTransaction {
    if (reference === undefined) {
      throw new Error(`${this.kind} exige uma transação de referência`);
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new Error('A transação de referência deve estar processada');
    }

    if (!allowedKinds.includes(reference.kind)) {
      throw new Error(
        `${this.kind} não pode referenciar uma transação ${reference.kind}`,
      );
    }

    if (
      this.referenceExternalTransactionId !==
      reference.externalTransactionId
    ) {
      throw new Error('A referência externa não corresponde à transação');
    }

    const hasSameContext =
      this.providerId === reference.providerId &&
      this.playerId === reference.playerId &&
      this.walletId === reference.walletId &&
      this.roundId === reference.roundId &&
      this.money.currency === reference.money.currency;

    if (!hasSameContext) {
      throw new Error('A transação de referência pertence a outro contexto');
    }

    if (requiresSameAmount && !this.money.equals(reference.money)) {
      throw new Error('O valor deve ser igual ao da transação de referência');
    }
  }
}
