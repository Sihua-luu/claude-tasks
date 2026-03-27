import { describe, it, expect } from 'vitest';
import { formatTimeBucket, timeBucketsInRange } from '../util.js';

describe('formatTimeBucket', () => {
  it('should format ISO date to YYYYMMDDHH', () => {
    expect(formatTimeBucket('2024-03-15T14:30:00.000Z')).toBe('2024031514');
  });

  it('should pad single-digit months and hours', () => {
    expect(formatTimeBucket('2024-01-05T03:00:00.000Z')).toBe('2024010503');
  });

  it('should handle midnight', () => {
    expect(formatTimeBucket('2024-12-31T00:00:00.000Z')).toBe('2024123100');
  });
});

describe('timeBucketsInRange', () => {
  it('should return buckets covering the range', () => {
    const from = new Date('2024-03-15T14:30:00Z');
    const to = new Date('2024-03-15T16:15:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024031514', '2024031515', '2024031516']);
  });

  it('should return single bucket for same hour', () => {
    const from = new Date('2024-03-15T14:00:00Z');
    const to = new Date('2024-03-15T14:59:00Z');
    const buckets = timeBucketsInRange(from, to);
    expect(buckets).toEqual(['2024031514']);
  });
});
