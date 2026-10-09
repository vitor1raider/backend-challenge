import { Injectable, Logger } from '@nestjs/common';

export interface ObservabilityContext {
  readonly correlationId?: string;
  readonly messageId?: string;
  readonly transactionId?: string;
  readonly walletId?: string;
  readonly providerId?: string;
  readonly aggregateId?: string;
  readonly queueName?: string;
  readonly receiveCount?: number;
  readonly attempt?: number;
  readonly acknowledged?: boolean;
  readonly retryScheduled?: boolean;
  readonly retryVisibilityTimeout?: number;
}

interface ErrorLog {
  readonly name: string;
  readonly message: string;
}

interface LogEntry extends ObservabilityContext {
  readonly component: string;
  readonly operation: string;
  readonly error?: ErrorLog;
}

@Injectable()
export class Observability {
  private readonly logger = new Logger('Aplicação');

  reportInfo(
    component: string,
    operation: string,
    context: ObservabilityContext = {},
  ): void {
    this.logger.log(this.createEntry(component, operation, context));
  }

  reportError(
    component: string,
    operation: string,
    error: unknown,
    context: ObservabilityContext = {},
  ): void {
    const entry = this.createEntry(component, operation, context, error);
    this.logger.error(entry, error instanceof Error ? error.stack : undefined);
  }

  reportWarning(
    component: string,
    operation: string,
    error: unknown,
    context: ObservabilityContext = {},
  ): void {
    this.logger.warn(this.createEntry(component, operation, context, error));
  }

  private createEntry(
    component: string,
    operation: string,
    context: ObservabilityContext,
    error?: unknown,
  ): LogEntry {
    return {
      component,
      operation,
      ...context,
      ...(error === undefined ? {} : { error: normalizeError(error) }),
    };
  }
}

function normalizeError(error: unknown): ErrorLog {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: 'Error', message: String(error) };
}
