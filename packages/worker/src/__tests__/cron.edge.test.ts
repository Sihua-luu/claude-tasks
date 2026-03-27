import { describe, it, expect } from 'vitest';
import cronParser from 'cron-parser';

describe('cron edge cases', () => {
  it('should handle leap year: Feb 29 cron only fires on leap years', () => {
    // "At 00:00 on day-of-month 29 in February"
    const expr = cronParser.parseExpression('0 0 29 2 *', {
      currentDate: new Date('2024-02-29T00:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    // Next Feb 29 is 2028
    expect(next.getUTCFullYear()).toBe(2028);
    expect(next.getUTCMonth()).toBe(1); // February
    expect(next.getUTCDate()).toBe(29);
  });

  it('should handle every-minute cron', () => {
    const expr = cronParser.parseExpression('* * * * *', {
      currentDate: new Date('2024-03-15T08:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCMinutes()).toBe(1);
    expect(next.getTime() - new Date('2024-03-15T08:00:00Z').getTime()).toBe(60000);
  });

  it('should handle midnight-crossing cron (23:59 → 00:00)', () => {
    const expr = cronParser.parseExpression('0 0 * * *', {
      currentDate: new Date('2024-03-15T23:59:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCDate()).toBe(16);
    expect(next.getUTCHours()).toBe(0);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('should handle year-boundary cron (Dec 31 → Jan 1)', () => {
    const expr = cronParser.parseExpression('0 0 * * *', {
      currentDate: new Date('2024-12-31T00:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    expect(next.getUTCFullYear()).toBe(2025);
    expect(next.getUTCMonth()).toBe(0);
    expect(next.getUTCDate()).toBe(1);
  });

  it('should handle weekday-only cron (Mon-Fri)', () => {
    // 2024-03-15 is a Friday
    const expr = cronParser.parseExpression('0 9 * * 1-5', {
      currentDate: new Date('2024-03-15T09:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    // Next weekday after Friday 09:00 is Monday
    expect(next.getUTCDate()).toBe(18); // Monday Mar 18
    expect(next.getUTCHours()).toBe(9);
  });

  it('should handle weekend-only cron (Sat-Sun)', () => {
    // 2024-03-15 is a Friday
    const expr = cronParser.parseExpression('0 10 * * 6,0', {
      currentDate: new Date('2024-03-15T09:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    // Next Saturday is Mar 16
    expect(next.getUTCDate()).toBe(16);
    expect(next.getUTCHours()).toBe(10);
  });

  it('should handle invalid cron expression', () => {
    expect(() => {
      cronParser.parseExpression('invalid cron', { utc: true });
    }).toThrow();
  });

  it('should handle cron with too many fields', () => {
    expect(() => {
      cronParser.parseExpression('* * * * * * *', { utc: true });
    }).toThrow();
  });

  it('should handle multiple next() calls maintaining sequence', () => {
    const expr = cronParser.parseExpression('0 * * * *', {
      currentDate: new Date('2024-03-15T14:00:00Z'),
      utc: true,
    });
    const first = expr.next().toDate();
    const second = expr.next().toDate();
    const third = expr.next().toDate();
    expect(first.getUTCHours()).toBe(15);
    expect(second.getUTCHours()).toBe(16);
    expect(third.getUTCHours()).toBe(17);
  });

  it('should handle end-of-month day 31 (not all months have 31 days)', () => {
    // "At 00:00 on day-of-month 31" — skips months without 31 days
    const expr = cronParser.parseExpression('0 0 31 * *', {
      currentDate: new Date('2024-01-31T00:00:00Z'),
      utc: true,
    });
    const next = expr.next().toDate();
    // February has no 31st; next 31st is March 31
    expect(next.getUTCMonth()).toBe(2); // March
    expect(next.getUTCDate()).toBe(31);
  });
});

describe('shard distribution', () => {
  it('should produce shard suffixes in range 00..31', () => {
    const shards = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const shard = Math.floor(Math.random() * 32)
        .toString()
        .padStart(2, '0');
      shards.add(shard);
      const num = parseInt(shard, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(31);
    }
    // With 1000 iterations, extremely unlikely to miss any shard
    expect(shards.size).toBe(32);
  });

  it('should format shard suffix with leading zero', () => {
    const shard = (0).toString().padStart(2, '0');
    expect(shard).toBe('00');
    const shard9 = (9).toString().padStart(2, '0');
    expect(shard9).toBe('09');
    const shard31 = (31).toString().padStart(2, '0');
    expect(shard31).toBe('31');
  });
});

describe('sort key ordering', () => {
  it('should maintain lexicographic order for ISO timestamps', () => {
    const keys = [
      '2024-03-15T14:00:00.000Z#job1',
      '2024-03-15T14:00:01.000Z#job2',
      '2024-03-15T14:01:00.000Z#job3',
      '2024-03-15T15:00:00.000Z#job4',
      '2024-03-16T00:00:00.000Z#job5',
    ];
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
  });

  it('should sort same-timestamp entries by job_id', () => {
    const keys = [
      '2024-03-15T14:00:00.000Z#01HRZABC',
      '2024-03-15T14:00:00.000Z#01HRZDEF',
      '2024-03-15T14:00:00.000Z#01HRZGHI',
    ];
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
  });
});

describe('pagination token encoding', () => {
  it('should roundtrip base64url encode/decode', () => {
    const original = { user_id: 'user-1', job_id: '01HRZABC', created_at: '2024-03-15T14:00:00Z' };
    const encoded = Buffer.from(JSON.stringify(original)).toString('base64url');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    expect(decoded).toEqual(original);
  });

  it('should handle special characters in user_id', () => {
    const original = { user_id: 'user@domain.com/+special=', job_id: '01HRZABC' };
    const encoded = Buffer.from(JSON.stringify(original)).toString('base64url');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    expect(decoded).toEqual(original);
  });

  it('should produce URL-safe token (no +, /, =)', () => {
    const original = { user_id: 'test', job_id: '01HRZABC' };
    const encoded = Buffer.from(JSON.stringify(original)).toString('base64url');
    expect(encoded).not.toMatch(/[+/=]/);
  });
});
