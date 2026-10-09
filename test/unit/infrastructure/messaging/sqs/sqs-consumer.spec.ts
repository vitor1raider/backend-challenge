import {
  ChangeMessageVisibilityCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { describe, expect, test } from 'bun:test';
import { Observability } from '../../../../../src/infrastructure/observability/observability';
import {
  calculateRetryVisibilityTimeout,
  SqsConsumer,
} from '../../../../../src/infrastructure/messaging/sqs/sqs-consumer';

describe('SqsConsumer retry backoff', () => {
  test('calculates exponential visibility timeouts capped at the configured maximum', () => {
    expect(calculateRetryVisibilityTimeout(1, 5, 60)).toBe(5);
    expect(calculateRetryVisibilityTimeout(2, 5, 60)).toBe(10);
    expect(calculateRetryVisibilityTimeout(3, 5, 60)).toBe(20);
    expect(calculateRetryVisibilityTimeout(10, 5, 60)).toBe(60);
  });

  test('changes message visibility after a processing failure', async () => {
    const commands: unknown[] = [];
    const client = {
      async send(command: unknown) {
        commands.push(command);
        if (command instanceof ReceiveMessageCommand) {
          return {
            Messages: [{
              MessageId: 'sqs-message-1',
              ReceiptHandle: 'receipt-1',
              Body: '{}',
              Attributes: { ApproximateReceiveCount: '3' },
            }],
          };
        }
        return {};
      },
    } as unknown as SQSClient;
    const consumer = new SqsConsumer(
      client,
      { handle: async () => { throw new Error('temporary failure'); } },
      {
        queueUrl: 'http://sqs/queue',
        waitTimeSeconds: 0,
        visibilityTimeoutSeconds: 30,
        retryBackoffBaseSeconds: 5,
        retryBackoffMaxSeconds: 60,
        maxReceiveCount: 5,
      },
      new Observability(),
    );

    expect(await consumer.pollOnce()).toBe(1);
    const changeVisibility = commands.find(
      (command) => command instanceof ChangeMessageVisibilityCommand,
    ) as ChangeMessageVisibilityCommand | undefined;

    expect(changeVisibility).toBeDefined();
    expect(changeVisibility?.input).toEqual({
      QueueUrl: 'http://sqs/queue',
      ReceiptHandle: 'receipt-1',
      VisibilityTimeout: 20,
    });
  });
});
