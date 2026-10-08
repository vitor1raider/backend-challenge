import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  SQS_CLIENT,
  SqsInfrastructure,
} from '../../../infrastructure/messaging/sqs/sqs-infrastructure';

@Controller('health')
export class HealthController {
  constructor(
    private readonly entityManager: EntityManager,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
    private readonly sqsInfrastructure: SqsInfrastructure,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [postgres, sqs] = await Promise.allSettled([
      this.entityManager.getConnection().execute('select 1'),
      this.sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: this.sqsInfrastructure.wagerTransactionsUrl,
        AttributeNames: ['QueueArn'],
      })),
    ]);
    const checks = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      sqs: sqs.status === 'fulfilled' ? 'up' : 'down',
    } as const;

    if (postgres.status === 'rejected' || sqs.status === 'rejected') {
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }
    return { status: 'ready', checks };
  }
}
