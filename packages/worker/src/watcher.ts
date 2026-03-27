import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand, CreateQueueCommand } from '@aws-sdk/client-sqs';

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
});
const ddb = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
});

const SHARD_COUNT = 32;
const SCAN_AHEAD_MINUTES = 5;
const POLL_INTERVAL_MS = 60_000;

function formatTimeBucket(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

function timeBucketsInRange(from: Date, to: Date): string[] {
  const buckets: string[] = [];
  const current = new Date(from);
  current.setUTCMinutes(0, 0, 0);
  while (current <= to) {
    buckets.push(formatTimeBucket(current));
    current.setUTCHours(current.getUTCHours() + 1);
  }
  return buckets;
}

let queueUrl: string | undefined;

async function getQueueUrl(): Promise<string> {
  if (queueUrl) return queueUrl;
  const res = await sqs.send(new CreateQueueCommand({ QueueName: 'job-runs' }));
  queueUrl = res.QueueUrl!;
  return queueUrl;
}

async function scanAndEnqueue(): Promise<void> {
  const now = new Date();
  const ahead = new Date(now.getTime() + SCAN_AHEAD_MINUTES * 60_000);
  const buckets = timeBucketsInRange(now, ahead);
  const url = await getQueueUrl();

  for (const bucket of buckets) {
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      const shardKey = `${bucket}#S${shard.toString().padStart(2, '0')}`;

      const result = await ddb.send(
        new QueryCommand({
          TableName: 'JobRun',
          KeyConditionExpression:
            'time_bucket = :tb AND scheduled_at_job_id <= :upper',
          FilterExpression: '#s = :pending',
          ExpressionAttributeValues: {
            ':tb': shardKey,
            ':upper': `${ahead.toISOString()}#~`,
            ':pending': 'PENDING',
            ':running': 'RUNNING',
          },
          ExpressionAttributeNames: { '#s': 'status' },
        }),
      );

      for (const item of result.Items ?? []) {
        // Claim-and-mark: conditional update to prevent duplicate dispatch
        try {
          await ddb.send(
            new UpdateCommand({
              TableName: 'JobRun',
              Key: {
                time_bucket: item.time_bucket,
                scheduled_at_job_id: item.scheduled_at_job_id,
              },
              UpdateExpression: 'SET #s = :running',
              ConditionExpression: '#s = :pending',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':running': 'RUNNING',
                ':pending': 'PENDING',
              },
            }),
          );

          // Send to SQS
          await sqs.send(
            new SendMessageCommand({
              QueueUrl: url,
              MessageBody: JSON.stringify({
                run_id: item.run_id,
                job_id: item.job_id,
                action: item.action,
              }),
            }),
          );

          console.log(`Enqueued run ${item.run_id} for job ${item.job_id}`);
        } catch (err: unknown) {
          if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
            // Already claimed by another watcher
            continue;
          }
          throw err;
        }
      }
    }
  }
}

export async function startWatcher(): Promise<void> {
  console.log('Watcher started. Polling every', POLL_INTERVAL_MS / 1000, 'seconds');
  const tick = async () => {
    try {
      await scanAndEnqueue();
    } catch (err) {
      console.error('Watcher error:', err);
    }
  };
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}
