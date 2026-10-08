import { Module } from '@nestjs/common';
import { ApplicationModule } from '../../application/application.module';
import { WalletController } from './wallet/wallet.controller';
import { SqsModule } from '../../infrastructure/messaging/sqs';
import { HealthController } from './health/health.controller';
import { ProviderWageringController } from './providers/provider-wagering.controller';
import { WageringController } from './wagering/wagering.controller';
import { MetricsController } from './metrics/metrics.controller';

@Module({
  imports: [ApplicationModule, SqsModule],
  controllers: [
    WalletController,
    WageringController,
    ProviderWageringController,
    HealthController,
    MetricsController,
  ],
})
export class HttpModule {}
