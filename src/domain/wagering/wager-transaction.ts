import type { Money } from '../money/money';
import { LedgerDirection } from '../wallet/wallet-ledger-entry';

export class InvalidTransactionStateError extends Error {
  constructor(
    currentStatus: WagerTransactionStatus,
    targetStatus: WagerTransactionStatus,
  ) {
    super(`Transição inválida de ${currentStatus} para ${targetStatus}`);
    this.name = 'InvalidTransactionStateError';
  }
}

export enum WagerTransactionKind {
  Opening = 'OPENING', // interno: crédito de abertura da wallet
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING', // aceita, ainda não aplicada
  PendingReference = 'PENDING_REFERENCE', // aguardando a transação referenciada
  Processed = 'PROCESSED', // aplicada (terminal)
  Rejected = 'REJECTED', // violação de regra de negócio (terminal)
  Failed = 'FAILED', // erro permanente de infraestrutura (terminal, auditável)
}

export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  WalletNotFound = 'WALLET_NOT_FOUND',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  ReferenceContextMismatch = 'REFERENCE_CONTEXT_MISMATCH',
  ReferenceAmountMismatch = 'REFERENCE_AMOUNT_MISMATCH',
  ReferenceAlreadyRefunded = 'REFERENCE_ALREADY_REFUNDED',
  ReferenceAlreadyRolledBack = 'REFERENCE_ALREADY_ROLLED_BACK',
  ReversalWouldCauseNegativeBalance = 'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',
  PermanentInfrastructureFailure = 'PERMANENT_INFRASTRUCTURE_FAILURE',
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
  ) {}

  // - A transação nasce em PENDING.
  // - REFUND exige referenceExternalTransactionId.
  // - ROLLBACK exige referenceExternalTransactionId.
  // - Referência vazia ou cercada por espaços é rejeitada.
  // - WIN pode ter referência opcional.
  // - OPENING pode ser criado internamente.
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    // verficar se o tipo de transação exige uma referência e se a referência é válida
    const requiresReference =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    // verificar se a referência é válida
    const referenceExternalTransactionId = props.referenceExternalTransactionId;
    // referência válida se não for undefined, não for vazia e não tiver espaços em branco
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

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
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

  reject(code: FailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Rejected);
    this._failureCode = code;
    this._status = WagerTransactionStatus.Rejected;
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
