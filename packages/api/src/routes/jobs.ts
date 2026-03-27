import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ddb } from '../db/client.js';
import { enqueueJobRun } from '../db/sqs.js';
import { formatTimeBucket } from '../util.js';

const CreateJobSchema = z.object({
  action: z.string().min(1),
  job_params: z.object({
    type: z.enum(['immediate', 'one-time', 'recurring']),
    time: z.string().datetime({ offset: true }).optional(),
    schedule: z.string().optional(),
  }),
});

const ListJobsSchema = z.object({
  status: z.string().optional(),
  start_time: z.string().datetime({ offset: true }).optional(),
  end_time: z.string().datetime({ offset: true }).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  page: z.string().optional(),
});

export const jobsRouter = Router();

// POST /v1/jobs — Create Job
jobsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'USER_INPUT',
        message: parsed.error.issues[0].message,
        field: parsed.error.issues[0].path.join('.'),
        expected: [],
      },
    });
    return;
  }

  const { action, job_params } = parsed.data;
  const userId = (req.headers['x-user-id'] as string) ?? 'default-user';
  const jobId = ulid();
  const now = new Date().toISOString();

  // Determine scheduled_at
  let scheduledAt: string;
  if (job_params.type === 'one-time' && job_params.time) {
    scheduledAt = job_params.time;
  } else {
    scheduledAt = now;
  }

  // Validate required fields per type
  if (job_params.type === 'one-time' && !job_params.time) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'USER_INPUT',
        message: "'time' is required for one-time jobs.",
        field: 'job_params.time',
        expected: ['ISO8601 datetime'],
      },
    });
    return;
  }
  if (job_params.type === 'recurring' && !job_params.schedule) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'USER_INPUT',
        message: "'schedule' is required for recurring jobs.",
        field: 'job_params.schedule',
        expected: ['cron expression'],
      },
    });
    return;
  }

  // Write to Jobs table
  await ddb.send(
    new PutCommand({
      TableName: 'Jobs',
      Item: {
        user_id: userId,
        job_id: jobId,
        action,
        type: job_params.type,
        time: job_params.time,
        schedule: job_params.schedule,
        created_at: now,
        status: 'ACTIVE',
      },
    }),
  );

  // Create initial JobRun
  const runId = ulid();
  const shardSuffix = Math.floor(Math.random() * 32)
    .toString()
    .padStart(2, '0');
  const timeBucket = `${formatTimeBucket(scheduledAt)}#S${shardSuffix}`;
  const sortKey = `${scheduledAt}#${jobId}`;

  await ddb.send(
    new PutCommand({
      TableName: 'JobRun',
      Item: {
        time_bucket: timeBucket,
        scheduled_at_job_id: sortKey,
        run_id: runId,
        job_id: jobId,
        scheduled_at: scheduledAt,
        status: 'PENDING',
        action,
        job_type: job_params.type,
        schedule: job_params.schedule,
      },
    }),
  );

  // For immediate jobs, enqueue directly to SQS
  if (job_params.type === 'immediate') {
    await enqueueJobRun({ run_id: runId, job_id: jobId, action });
  }

  res.status(201).json({
    ok: true,
    data: { job_id: jobId, run_id: runId, status: 'PENDING' },
  });
});

// GET /v1/jobs — List Jobs
jobsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = ListJobsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'USER_INPUT',
        message: parsed.error.issues[0].message,
        field: parsed.error.issues[0].path.join('.'),
        expected: [],
      },
    });
    return;
  }

  const { status, start_time, end_time, pageSize, page } = parsed.data;
  const userId = (req.headers['x-user-id'] as string) ?? 'default-user';

  let keyCondition = 'user_id = :uid';
  const exprValues: Record<string, string> = { ':uid': userId };

  if (start_time && end_time) {
    keyCondition += ' AND created_at BETWEEN :st AND :et';
    exprValues[':st'] = start_time;
    exprValues[':et'] = end_time;
  } else if (start_time) {
    keyCondition += ' AND created_at >= :st';
    exprValues[':st'] = start_time;
  } else if (end_time) {
    keyCondition += ' AND created_at <= :et';
    exprValues[':et'] = end_time;
  }

  let filterExpression: string | undefined;
  if (status) {
    filterExpression = '#s = :status';
    exprValues[':status'] = status;
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: 'Jobs',
      IndexName: 'GSI_UserCreatedAt',
      KeyConditionExpression: keyCondition,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: exprValues,
      ExpressionAttributeNames: status ? { '#s': 'status' } : undefined,
      Limit: pageSize,
      ExclusiveStartKey: page ? JSON.parse(Buffer.from(page, 'base64url').toString()) : undefined,
      ScanIndexForward: false,
    }),
  );

  const nextPage = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
    : undefined;

  res.json({
    ok: true,
    data: result.Items ?? [],
    pagination: { next_page: nextPage },
  });
});

// POST /v1/jobs/:jobId/cancel — Cancel a Job
jobsRouter.post('/:jobId/cancel', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] as string) ?? 'default-user';
  const { jobId } = req.params;

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: 'Jobs',
        Key: { user_id: userId, job_id: jobId },
        UpdateExpression: 'SET #s = :cancelled',
        ConditionExpression: 'attribute_exists(job_id)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':cancelled': 'CANCELLED' },
      }),
    );

    res.json({ ok: true, data: { job_id: jobId, status: 'CANCELLED' } });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Job ${jobId} not found.` },
      });
      return;
    }
    throw err;
  }
});
