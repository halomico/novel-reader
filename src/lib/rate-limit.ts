type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = params.now || Date.now();
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
