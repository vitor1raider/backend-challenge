import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../domain/enums';
import {
  GetWagerTransactionUseCase,
  WagerTransactionNotFoundError,
} from '../../../application/wagering/get-wager-transaction.use-case';
import {
  IdempotencyConflictError,
  ProcessWagerTransactionUseCase,
} from '../../../application/wagering/process-wager-transaction.use-case';
import { SubmitWagerTransactionDto } from './submit-wager-transaction.dto';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Post()
  async submit(
    @Body() body: SubmitWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const key = idempotencyKey?.trim();
    if (!key) throw new BadRequestException('O header Idempotency-Key é obrigatório');
    if (body.money.amount === '0.00') {
      throw new BadRequestException('money.amount deve ser maior que zero');
    }
    if (
      (body.kind === WagerTransactionKind.Refund ||
        body.kind === WagerTransactionKind.Rollback) &&
      !body.referenceExternalTransactionId?.trim()
    ) {
      throw new BadRequestException(
        `${body.kind} exige referenceExternalTransactionId`,
      );
    }

    try {
      const result = await this.processWagerTransactionUseCase.execute({
        idempotencyKey: key,
        data: body,
        correlationId: correlationId?.trim() || randomUUID(),
      });
      if (result.status === WagerTransactionStatus.PendingReference) {
        response.status(202);
      } else if (result.status === WagerTransactionStatus.Rejected) {
        throw new UnprocessableEntityException(result);
      } else {
        response.status(201);
      }
      return result;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get(':transactionId')
  async getById(
    @Param('transactionId', new ParseUUIDPipe({ version: 'all' })) transactionId: string,
  ) {
    try {
      return await this.getWagerTransactionUseCase.execute(transactionId);
    } catch (error) {
      if (error instanceof WagerTransactionNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
