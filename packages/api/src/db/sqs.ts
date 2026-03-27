import { SQSClient, SendMessageCommand, CreateQueueCommand } from '@aws-sdk/client-sqs';

export const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
});

const QUEUE_NAME = 'job-runs';
let queueUrl: string | undefined;

export async function getQueueUrl(): Promise<string> {
  if (queueUrl) return queueUrl;
  const res = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
  queueUrl = res.QueueUrl!;
  return queueUrl;
}

export async function enqueueJobRun(payload: {
  run_id: string;
  job_id: string;
  action: string;
}): Promise<void> {
  const url = await getQueueUrl();
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: payload.job_id,
    }),
  );
}
