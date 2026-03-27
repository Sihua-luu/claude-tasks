import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirror the schemas from routes/jobs.ts for isolated testing
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

describe('CreateJobSchema — edge cases', () => {
  it('should reject empty action string', () => {
    const result = CreateJobSchema.safeParse({
      action: '',
      job_params: { type: 'immediate' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing action field', () => {
    const result = CreateJobSchema.safeParse({
      job_params: { type: 'immediate' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing job_params', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type enum', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'daily' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid time format (not ISO8601)', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'one-time', time: '2024-13-01' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid time format (plain date without time)', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'one-time', time: '2024-03-15' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid ISO8601 with timezone offset', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'one-time', time: '2024-03-15T08:00:00+08:00' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid ISO8601 with Z suffix', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'one-time', time: '2024-03-15T08:00:00Z' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept immediate type with extra time field (ignored)', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'immediate', time: '2024-03-15T08:00:00Z' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept recurring type with schedule field', () => {
    const result = CreateJobSchema.safeParse({
      action: 'summarize_news',
      job_params: { type: 'recurring', schedule: '0 8 * * *' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject completely empty body', () => {
    const result = CreateJobSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject null body', () => {
    const result = CreateJobSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('should reject array body', () => {
    const result = CreateJobSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('should accept action with special characters', () => {
    const result = CreateJobSchema.safeParse({
      action: 'my-custom_action.v2',
      job_params: { type: 'immediate' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept very long action string', () => {
    const result = CreateJobSchema.safeParse({
      action: 'a'.repeat(10000),
      job_params: { type: 'immediate' },
    });
    expect(result.success).toBe(true);
  });
});

describe('ListJobsSchema — edge cases', () => {
  it('should accept empty query (all defaults)', () => {
    const result = ListJobsSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.pageSize).toBe(20);
  });

  it('should reject pageSize = 0', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '0' });
    expect(result.success).toBe(false);
  });

  it('should reject pageSize = -1', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '-1' });
    expect(result.success).toBe(false);
  });

  it('should reject pageSize > 100', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '101' });
    expect(result.success).toBe(false);
  });

  it('should accept pageSize = 1 (minimum)', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '1' });
    expect(result.success).toBe(true);
    expect(result.data?.pageSize).toBe(1);
  });

  it('should accept pageSize = 100 (maximum)', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '100' });
    expect(result.success).toBe(true);
    expect(result.data?.pageSize).toBe(100);
  });

  it('should reject non-numeric pageSize', () => {
    const result = ListJobsSchema.safeParse({ pageSize: 'abc' });
    expect(result.success).toBe(false);
  });

  it('should reject float pageSize', () => {
    const result = ListJobsSchema.safeParse({ pageSize: '10.5' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid start_time format', () => {
    const result = ListJobsSchema.safeParse({ start_time: 'yesterday' });
    expect(result.success).toBe(false);
  });

  it('should accept valid start_time and end_time', () => {
    const result = ListJobsSchema.safeParse({
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-12-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept start_time after end_time (schema does not enforce order)', () => {
    const result = ListJobsSchema.safeParse({
      start_time: '2024-12-31T00:00:00Z',
      end_time: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
