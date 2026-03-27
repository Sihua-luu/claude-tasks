/**
 * Convert an ISO8601 date string to a time_bucket format: YYYYMMDDHH
 */
export function formatTimeBucket(isoDate: string): string {
  const d = new Date(isoDate);
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

/**
 * Generate all time_bucket values (without shard suffix) for a time range.
 */
export function timeBucketsInRange(from: Date, to: Date): string[] {
  const buckets: string[] = [];
  const current = new Date(from);
  current.setUTCMinutes(0, 0, 0);

  while (current <= to) {
    buckets.push(formatTimeBucket(current.toISOString()));
    current.setUTCHours(current.getUTCHours() + 1);
  }
  return buckets;
}

export const SHARD_COUNT = 32;
