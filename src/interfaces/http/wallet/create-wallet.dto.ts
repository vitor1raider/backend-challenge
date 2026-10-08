import { Type } from 'class-transformer';
import {
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class InitialBalanceDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,12})\.\d{2}$/, {
    message: 'initialBalance.amount deve ser uma string decimal com duas casas',
  })
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'initialBalance.currency deve usar o formato ISO-4217',
  })
  currency!: string;
}

export class CreateWalletDto {
  @IsUUID()
  playerId!: string;

  @ValidateNested()
  @Type(() => InitialBalanceDto)
  initialBalance!: InitialBalanceDto;
}
