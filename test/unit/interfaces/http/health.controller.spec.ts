import { describe, expect, mock, test } from 'bun:test';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ServiceUnavailableException } from '@nestjs/common';
import type { SqsInfrastructure } from '../../../../src/infrastructure/messaging/sqs/sqs-infrastructure';
import { HealthController } from '../../../../src/interfaces/http/health/health.controller';

describe('HealthController', () => {
  test('reports liveness without checking dependencies', () => {
    expect(createController().live()).toEqual({ status: 'ok' });
  });

  test('reports readiness when PostgreSQL and SQS are reachable', async () => {
    const controller = createController();
    expect(await controller.ready()).toEqual({
      status: 'ready',
      checks: { postgres: 'up', sqs: 'up' },
    });
  });

  test('returns HTTP 503 when a dependency is unavailable', async () => {
    const controller = createController(mock(async () => { throw new Error('database unavailable'); }));
    expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function createController(
  execute: () => Promise<unknown> = mock(async () => [{ '?column?': 1 }]),
): HealthController {
  const entityManager = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager;
  const sqsClient = { send: mock(async () => ({ Attributes: { QueueArn: 'arn' } })) } as unknown as SQSClient;
  const infrastructure = { wagerTransactionsUrl: 'http://sqs/queue' } as SqsInfrastructure;
  return new HealthController(entityManager, sqsClient, infrastructure);
}
