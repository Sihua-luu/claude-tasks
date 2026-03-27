import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import cronParser from 'cron-parser';

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
});
const ddb = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const POLL_INTERVAL_MS = 60_000;
const SHARD_COUNT = 32;

function formatTimeBucket(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

async function pollAndSchedule(): Promise<void> {
  // Scan RunEvent for SUCCEEDED events
  const result = await ddb.send(
    new ScanCommand({
      TableName: 'RunEvent',
      FilterExpression: '#s = :succeeded',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':succeeded': 'SUCCEEDED' },
    }),
  );

  for (const event of result.Items ?? []) {
    const runId = event.job_run_id as string;

    // Find the corresponding JobRun to check if it's recurring
    const jobRunResult = await ddb.send(
      new ScanCommand({
        TableName: 'JobRun',
        FilterExpression: 'run_id = :rid',
        ExpressionAttributeValues: { ':rid': runId },
        Limit: 1,
      }),
    );

    const jobRun = jobRunResult.Items?.[0];
    if (!jobRun || jobRun.job_type !== 'recurring' || !jobRun.schedule) continue;

    // Compute next run time from cron schedule
    const interval = cronParser.parseExpression(jobRun.schedule as string, {
      currentDate: new Date(jobRun.scheduled_at as string),
      utc: true,
    });
    const nextRun = interval.next().toDate();

    // Check if a run already exists for this next time (idempotent insert)
    const nextSortKey = `${nextRun.toISOString()}#${jobRun.job_id}`;
    const shardSuffix = Math.floor(Math.random() * SHARD_COUNT)
      .toString()
      .padStart(2, '0');
    const timeBucket = `${formatTimeBucket(nextRun)}#S${shardSuffix}`;

    // Check all shards for existing run
    let exists = false;
    for (let s = 0; s < SHARD_COUNT; s++) {
      const shardKey = `${formatTimeBucket(nextRun)}#S${s.toString().padStart(2, '0')}`;
      const existing = await ddb.send(
        new QueryCommand({
          TableName: 'JobRun',
          KeyConditionExpression: 'time_bucket = :tb AND scheduled_at_job_id = :sk',
          ExpressionAttributeValues: {
            ':tb': shardKey,
            ':sk': nextSortKey,
          },
          Limit: 1,
        }),
      );
      if ((existing.Items?.length ?? 0) > 0) {
        exists = true;
        break;
      }
    }

    if (exists) continue;

    const newRunId = ulid();
    await ddb.send(
      new PutCommand({
        TableName: 'JobRun',
        Item: {
          time_bucket: timeBucket,
          scheduled_at_job_id: nextSortKey,
          run_id: newRunId,
          job_id: jobRun.job_id,
          scheduled_at: nextRun.toISOString(),
          status: 'PENDING',
          action: jobRun.action,
          job_type: 'recurring',
          schedule: jobRun.schedule,
        },
        ConditionExpression: 'attribute_not_exists(run_id)',
      }),
    );

    console.log(
      `Scheduled next recurring run ${newRunId} for job ${jobRun.job_id} at ${nextRun.toISOString()}`,
    );
  }
}

export async function startRecurringWatcher(): Promise<void> {
  console.log('RecurringJobWatcher started. Polling every', POLL_INTERVAL_MS / 1000, 'seconds');
  const tick = async () => {
    try {
      await pollAndSchedule();
    } catch (err) {
      console.error('RecurringJobWatcher error:', err);
    }
  };
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}
