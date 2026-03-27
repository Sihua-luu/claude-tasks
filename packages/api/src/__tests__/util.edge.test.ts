import { describe, it, expect } from 'vitest';
import { formatTimeBucket, timeBucketsInRange } from '../util.js';

describe('formatTimeBucket — edge cases', () => {
  it('should handle year boundary (New Year midnight)', () => {
    expect(formatTimeBucket('2024-12-31T23:59:59.999Z')).toBe('2024123123');
    expect(formatTimeBucket('2025-01-01T00:00:00.000Z')).toBe('2025010100');
  });

  it('should handle leap year Feb 29', () => {
    expect(formatTimeBucket('2024-02-29T12:00:00.000Z')).toBe('2024022912');
  });

  it('should handle non-leap year (Feb 28 → Mar 1 boundary)', () => {
    expect(formatTimeBucket('2023-02-28T23:00:00.000Z')).toBe('2023022823');
    expect(formatTimeBucket('2023-03-01T00:00:00.000Z')).toBe('2023030100');
  });

  it('should handle last hour of day (23:xx)', () => {
    expect(formatTimeBucket('2024-06-15T23:59:59.000Z')).toBe('2024061523');
  });

  it('should handle DST-ambiguous times correctly (uses UTC)', () => {
    // 2024-03-10 02:00 is DST spring-forward in US, but we use UTC so no issue
    expect(formatTimeBucket('2024-03-10T02:00:00.000Z')).toBe('2024031002');
    expect(formatTimeBucket('2024-03-10T03:00:00.000Z')).toBe('2024031003');
  });

  it('should handle milliseconds correctly (truncate, not round)', () => {
    expect(formatTimeBucket('2024-06-15T14:59:59.999Z')).toBe('2024061514');
  });

  it('should return NaN-free string for invalid date', () => {
    const result = formatTimeBucket('invalid');
    expect(result).toContain('NaN');
  });
});

describe('timeBucketsInRange — edge cases', () => {
  it('should handle from === to (exact hour boundary)', () => {
    const t = new Date('2024-03-15T14:00:00Z');
    const buckets = timeBucketsInRange(t, t);
    expect(buckets).toEqual(['2024031514']);
  });

  it('should handle from > to (empty result)', () => {
    const from = new Date('2024-03-15T16:00:00Z');
    const to = new Date('2024-03-15T14:00:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual([]);
  });

  it('should handle cross-day boundary', () => {
    const from = new Date('2024-03-15T23:30:00Z');
    const to = new Date('2024-03-16T01:15:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024031523', '2024031600', '2024031601']);
  });

  it('should handle cross-month boundary', () => {
    const from = new Date('2024-01-31T23:00:00Z');
    const to = new Date('2024-02-01T01:00:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024013123', '2024020100', '2024020101']);
  });

  it('should handle cross-year boundary', () => {
    const from = new Date('2024-12-31T23:00:00Z');
    const to = new Date('2025-01-01T01:00:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024123123', '2025010100', '2025010101']);
  });

  it('should handle leap year day boundary', () => {
    const from = new Date('2024-02-28T23:00:00Z');
    const to = new Date('2024-02-29T01:00:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024022823', '2024022900', '2024022901']);
  });

  it('should handle large range (24 hours = 25 buckets)', () => {
    const from = new Date('2024-03-15T00:00:00Z');
    const to = new Date('2024-03-16T00:00:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toHaveLength(25); // 00..23 + next day 00
    expect(buckets[0]).toBe('2024031500');
    expect(buckets[24]).toBe('2024031600');
  });

  it('should handle from at minute :59 and to at minute :01 of next hour', () => {
    const from = new Date('2024-03-15T14:59:00Z');
    const to = new Date('2024-03-15T15:01:00Z');
    const buckets = timeBucketsInRange(from, to);
    // from is truncated to 14:00, so 14 and 15 are covered
    expect(buckets).toEqual(['2024031514', '2024031515']);
  });
});
