import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WagerTransactionKind } from '../../../domain/enums';

const acceptedKinds = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
] as const;

class WagerMoneyDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,12})\.\d{2}$/)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class SubmitWagerTransactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  providerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  roundId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  gameId!: string;

  @IsIn(acceptedKinds)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => WagerMoneyDto)
  money!: WagerMoneyDto;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  referenceExternalTransactionId?: string;
}
