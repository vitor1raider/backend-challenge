export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxProps {
  processedAt: Date | undefined;
}

export class InboxMessageAlreadyProcessedError extends Error {
  constructor(messageId: string, consumerName: string) {
    super(
      `A mensagem ${messageId} já foi processada pelo consumidor ${consumerName}`,
    );
    this.name = 'InboxMessageAlreadyProcessedError';
  }
}

export class InboxMessage {
  private readonly _receivedAt: Date;

  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    receivedAt: Date,
    private _processedAt?: Date,
  ) {
    this._receivedAt = new Date(receivedAt.getTime());
    this._processedAt =
      _processedAt === undefined
        ? undefined
        : new Date(_processedAt.getTime());
  }

  static receive(props: ReceiveInboxProps): InboxMessage {
    InboxMessage.assertRequiredText(props.messageId, 'messageId');
    InboxMessage.assertRequiredText(props.consumerName, 'consumerName');
    InboxMessage.assertRequiredText(props.payloadHash, 'payloadHash');
    InboxMessage.assertValidDate(props.receivedAt, 'receivedAt');

    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get receivedAt(): Date {
    return new Date(this._receivedAt.getTime());
  }

  get processedAt(): Date | undefined {
    return this._processedAt === undefined
      ? undefined
      : new Date(this._processedAt.getTime());
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InboxMessageAlreadyProcessedError(
        this.messageId,
        this.consumerName,
      );
    }

    InboxMessage.assertValidDate(at, 'processedAt');

    if (at.getTime() < this._receivedAt.getTime()) {
      throw new Error('processedAt não pode ser anterior a receivedAt');
    }

    this._processedAt = new Date(at.getTime());
  }

  private static assertRequiredText(value: string, field: string): void {
    if (value.length === 0 || value !== value.trim()) {
      throw new Error(`${field} é obrigatório e não pode conter espaços externos`);
    }
  }

  private static assertValidDate(value: Date, field: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error(`${field} deve ser uma data válida`);
    }
  }
}
