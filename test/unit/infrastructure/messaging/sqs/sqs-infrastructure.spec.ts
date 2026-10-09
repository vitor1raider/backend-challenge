import { SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, test } from 'bun:test';
import { createSqsClient } from '../../../../../src/infrastructure/messaging/sqs/sqs-infrastructure';

describe('createSqsClient', () => {
  test('creates an SQS client', () => {
    const client = createSqsClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    expect(client).toBeInstanceOf(SQSClient);
    client.destroy();
  });
});
