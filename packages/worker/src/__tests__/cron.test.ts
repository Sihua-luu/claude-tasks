import { describe, it, expect } from 'vitest';
import cronParser from 'cron-parser';

describe('cron next run calculation', () => {
  it('should compute next run for daily 8am cron', () => {
    const expr = cronParser.parseExpression('0 8 * * *', {
      currentDate: new Date('2024-03-15T08:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCDate()).toBe(16);
  });

  it('should compute next run for every-5-minutes cron', () => {
    const expr = cronParser.parseExpression('*/5 * * * *', {
      currentDate: new Date('2024-03-15T08:03:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCMinutes()).toBe(5);
  });

  it('should handle monthly cron', () => {
    const expr = cronParser.parseExpression('0 0 1 * *', {
      currentDate: new Date('2024-03-01T00:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCMonth()).toBe(3); // April
    expect(next.getUTCDate()).toBe(1);
  });
});
