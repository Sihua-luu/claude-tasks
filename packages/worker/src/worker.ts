import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';
import { ulid } from 'ulid';

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

const MAX_RETRIES = 3;
const VISIBILITY_TIMEOUT = 60;
const HEARTBEAT_INTERVAL_MS = 30_000;

let queueUrl: string | undefined;

async function getQueueUrl(): Promise<string> {
  if (queueUrl) return queueUrl;
  const res = await sqs.send(new CreateQueueCommand({ QueueName: 'job-runs' }));
  queueUrl = res.QueueUrl!;
  return queueUrl;
}

// Action handlers registry
const actionHandlers: Record<string, (jobId: string) => Promise<void>> = {
  summarize_news: async (jobId) => {
    console.log(`[summarize_news] Executing for job ${jobId}`);
    // Placeholder: integrate with actual summarization logic
  },
  send_email: async (jobId) => {
    console.log(`[send_email] Executing for job ${jobId}`);
  },
  call_llm: async (jobId) => {
    console.log(`[call_llm] Executing for job ${jobId}`);
  },
};

async function checkIdempotency(runId: string): Promise<boolean> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: 'RunEvent',
      KeyConditionExpression: 'job_run_id = :rid',
      FilterExpression: '#s = :succeeded',
      ExpressionAttributeValues: { ':rid': runId, ':succeeded': 'SUCCEEDED' },
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 1,
    }),
  );
  return (result.Items?.length ?? 0) > 0;
}

async function updateJobRunStatus(
  jobId: string,
  runId: string,
  status: string,
): Promise<void> {
  // Find the job run by job_id GSI
  const result = await ddb.send(
    new QueryCommand({
      TableName: 'JobRun',
      IndexName: 'GSI_JobId',
      KeyConditionExpression: 'job_id = :jid',
      FilterExpression: 'run_id = :rid',
      ExpressionAttributeValues: { ':jid': jobId, ':rid': runId },
    }),
  );
  const item = result.Items?.[0];
  if (!item) return;

  await ddb.send(
    new UpdateCommand({
      TableName: 'JobRun',
      Key: {
        time_bucket: item.time_bucket,
        scheduled_at_job_id: item.scheduled_at_job_id,
      },
      UpdateExpression: 'SET #s = :status, finish_at = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': new Date().toISOString() },
    }),
  );
}

async function appendRunEvent(
  runId: string,
  status: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: 'RunEvent',
      Item: {
        job_run_id: runId,
        id: ulid(),
        created_at: new Date().toISOString(),
        status,
      },
    }),
  );
}

async function processMessage(message: {
  run_id: string;
  job_id: string;
  action: string;
}): Promise<void> {
  const { run_id, job_id, action } = message;

  // Idempotency check
  if (await checkIdempotency(run_id)) {
    console.log(`Run ${run_id} already succeeded, skipping.`);
    return;
  }

  const handler = actionHandlers[action];
  if (!handler) {
    console.error(`Unknown action: ${action}`);
    await updateJobRunStatus(job_id, run_id, 'FAILED');
    await appendRunEvent(run_id, 'FAILED');
    return;
  }

  await handler(job_id);
  await updateJobRunStatus(job_id, run_id, 'SUCCEEDED');
  await appendRunEvent(run_id, 'SUCCEEDED');
}

export async function startWorker(): Promise<void> {
  const url = await getQueueUrl();
  console.log('Worker started. Listening for messages...');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: VISIBILITY_TIMEOUT,
        }),
      );

      for (const msg of response.Messages ?? []) {
        if (!msg.Body || !msg.ReceiptHandle) continue;
        const payload = JSON.parse(msg.Body);
        let retryCount = 0;
        const receiptHandle = msg.ReceiptHandle;

        // Start visibility timeout heartbeat
        const heartbeat = setInterval(async () => {
          try {
            await sqs.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: url,
                ReceiptHandle: receiptHandle,
                VisibilityTimeout: VISIBILITY_TIMEOUT,
              }),
            );
          } catch {
            // Message may have been deleted or timed out
          }
        }, HEARTBEAT_INTERVAL_MS);

        try {
          while (retryCount < MAX_RETRIES) {
            try {
              await processMessage(payload);
              break;
            } catch (err) {
              retryCount++;
              if (retryCount >= MAX_RETRIES) {
                console.error(`Run ${payload.run_id} failed after ${MAX_RETRIES} retries:`, err);
                await updateJobRunStatus(payload.job_id, payload.run_id, 'FAILED');
                await appendRunEvent(payload.run_id, 'FAILED');
                // Message will go to DLQ after max receive count
              } else {
                console.warn(`Retry ${retryCount} for run ${payload.run_id}`);
                await updateJobRunStatus(payload.job_id, payload.run_id, 'RETRYING');
                // Exponential backoff
                await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
              }
            }
          }

          // Delete message on success or final failure
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }),
          );
        } finally {
          clearInterval(heartbeat);
        }
      }
    } catch (err) {
      console.error('Worker poll error:', err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
