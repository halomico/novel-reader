type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const BUCKET_CLEANUP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 100_000;
let nextCleanupAt = 0;

function cleanupBuckets(now: number) {
  if (now < nextCleanupAt && buckets.size < MAX_BUCKETS) {
    return;
  }
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  while (buckets.size >= MAX_BUCKETS) {
    const firstKey = buckets.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    buckets.delete(firstKey);
  }
  nextCleanupAt = now + BUCKET_CLEANUP_INTERVAL_MS;
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = params.now ?? Date.now();
  cleanupBuckets(now);
  const existing = buckets.get(params.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(params.key, {
      count: 1,
      resetAt: now + params.windowMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= params.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
