import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Headers,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateWalletUseCase,
  WalletAlreadyExistsError,
} from '../../../application/wallet/create-wallet.use-case';
import {
  InvalidLedgerCursorError,
  GetWalletLedgerUseCase,
} from '../../../application/wallet/get-wallet-ledger.use-case';
import {
  GetWalletUseCase,
  WalletNotFoundError,
} from '../../../application/wallet/get-wallet.use-case';
import { CreateWalletDto } from './create-wallet.dto';
import { ReconcileWalletUseCase } from '../../../application/wallet/reconcile-wallet.use-case';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
  ) {}

  @Post()
  async createWallet(
    @Body() body: CreateWalletDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    try {
      return await this.createWalletUseCase.execute({
        playerId: body.playerId,
        initialBalance: body.initialBalance,
        correlationId: correlationId?.trim() || randomUUID(),
      });
    } catch (error) {
      if (error instanceof WalletAlreadyExistsError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(
    @Param('walletId', new ParseUUIDPipe({ version: 'all' })) walletId: string,
  ) {
    try {
      return await this.reconcileWalletUseCase.execute(walletId);
    } catch (error) {
      this.rethrowHttpError(error);
    }
  }

  @Get(':walletId')
  async getWallet(
    @Param('walletId', new ParseUUIDPipe({ version: 'all' })) walletId: string,
  ) {
    try {
      return await this.getWalletUseCase.execute(walletId);
    } catch (error) {
      this.rethrowHttpError(error);
    }
  }

  @Get(':walletId/ledger')
  async getWalletLedger(
    @Param('walletId', new ParseUUIDPipe({ version: 'all' })) walletId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit deve estar entre 1 e 100');
    }

    try {
      return await this.getWalletLedgerUseCase.execute({
        walletId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
    } catch (error) {
      this.rethrowHttpError(error);
    }
  }

  private rethrowHttpError(error: unknown): never {
    if (error instanceof WalletNotFoundError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof InvalidLedgerCursorError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
