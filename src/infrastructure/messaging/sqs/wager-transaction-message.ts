import { WagerTransactionKind } from '../../../domain/enums';

export class SqsPermanentMessageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqsPermanentMessageError';
  }
}

export interface WagerTransactionMessageData {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: { readonly amount: string; readonly currency: string };
  readonly referenceExternalTransactionId?: string;
}

export interface WagerTransactionMessage {
  readonly messageId: string;
  readonly type: 'WagerTransactionRequested';
  readonly occurredAt: string;
  readonly data: WagerTransactionMessageData;
}

export function parseWagerTransactionMessage(
  body: string,
): WagerTransactionMessage {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (cause) {
    throw new SqsPermanentMessageError('O corpo da mensagem SQS não contém um JSON válido', {
      cause,
    });
  }

  if (!isRecord(value) || value.type !== 'WagerTransactionRequested') {
    throw new SqsPermanentMessageError('Tipo de mensagem SQS não suportado');
  }

  assertText(value.messageId, 'messageId');
  assertText(value.occurredAt, 'occurredAt');
  if (Number.isNaN(Date.parse(value.occurredAt))) {
    throw new SqsPermanentMessageError('occurredAt deve ser uma data ISO-8601');
  }

  if (!isRecord(value.data)) {
    throw new SqsPermanentMessageError('data deve ser um objeto');
  }
  assertTransactionData(value.data);

  return value as unknown as WagerTransactionMessage;
}

function assertTransactionData(
  data: Record<string, unknown>,
): asserts data is Record<string, unknown> & WagerTransactionMessageData {
  for (const field of [
    'providerId',
    'externalTransactionId',
    'idempotencyKey',
    'playerId',
    'walletId',
    'roundId',
    'gameId',
  ] as const) {
    assertText(data[field], `data.${field}`);
  }

  if (
    !Object.values(WagerTransactionKind).includes(
      data.kind as WagerTransactionKind,
    ) ||
    data.kind === WagerTransactionKind.Opening
  ) {
    throw new SqsPermanentMessageError('data.kind não é aceito');
  }

  if (!isRecord(data.money)) {
    throw new SqsPermanentMessageError('data.money deve ser um objeto');
  }
  assertText(data.money.amount, 'data.money.amount');
  assertText(data.money.currency, 'data.money.currency');

  if (data.referenceExternalTransactionId !== undefined) {
    assertText(
      data.referenceExternalTransactionId,
      'data.referenceExternalTransactionId',
    );
  }
}

function assertText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new SqsPermanentMessageError(`${field} é obrigatório`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
