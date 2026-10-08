import { Module } from '@nestjs/common';
import { Observability } from '../../observability/observability';
import { SqsOutboxPublisher } from './sqs-outbox.publisher';
import { WagerTransactionConsumer } from './sqs-consumer';
import {
  createSqsClient,
  createSqsConfig,
  SQS_CLIENT,
  SQS_CONFIG,
  SqsInfrastructure,
} from './sqs-infrastructure';
import { WagerTransactionMessageHandler } from './wager-transaction-message.handler';

@Module({
  providers: [
    {
      provide: SQS_CONFIG,
      useFactory: createSqsConfig,
    },
    {
      provide: SQS_CLIENT,
      useFactory: createSqsClient,
    },
    SqsInfrastructure,
    Observability,
    WagerTransactionMessageHandler,
    WagerTransactionConsumer,
    SqsOutboxPublisher,
  ],
})
export class SqsModule {}
