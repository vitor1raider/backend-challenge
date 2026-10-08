import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  GetProviderWagerTransactionUseCase,
  WagerTransactionNotFoundError,
} from '../../../application/wagering/get-wager-transaction.use-case';

@Controller('providers/:providerId/wagering/transactions')
export class ProviderWageringController {
  constructor(
    private readonly getProviderWagerTransactionUseCase: GetProviderWagerTransactionUseCase,
  ) {}

  @Get(':externalTransactionId')
  async getByExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    if (!providerId.trim() || !externalTransactionId.trim()) {
      throw new NotFoundException('Transação não encontrada');
    }
    try {
      return await this.getProviderWagerTransactionUseCase.execute(
        providerId,
        externalTransactionId,
      );
    } catch (error) {
      if (error instanceof WagerTransactionNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
