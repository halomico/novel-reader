import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

/**
 * Keeps one app instance answering when more visitors arrive than it can serve.
 *
 * Two signals show saturation before requests start failing: the event loop falling
 * behind (rendering has used up the CPU) and requests queueing for a PostgreSQL
 * connection (the pool is exhausted, and a query that waits past
 * PG_CONNECTION_TIMEOUT_MS fails as a 500). While either is high, middleware answers new
 * requests at once with 429 or 503 and a Retry-After, so the requests already admitted
 * finish instead of all of them timing out together.
 *
 * - busy: fire-and-forget beacons (view and search analytics) are refused;
 * - overloaded: everything except administration and health checks is refused.
 *
 * A raised level holds for a few seconds, so the instance drains its queue before it
 * admits the full load again.
 */
export type ServerPressure = "normal" | "busy" | "overloaded";
export type RequestPriority = "exempt" | "background" | "standard";

export type PressureThresholds = {
  busyEventLoopDelayMs: number;
  overloadedEventLoopDelayMs: number;
  busyPoolWaiting: number;
  overloadedPoolWaiting: number;
};

export type PressureSample = { eventLoopDelayMs: number; poolWaiting: number };
export type PressureState = { level: ServerPressure; holdUntil: number };

const RANK: Record<ServerPressure, number> = { normal: 0, busy: 1, overloaded: 2 };
const SAMPLE_INTERVAL_MS = 500;
const HOLD_MS = 3_000;
const LOG_INTERVAL_MS = 10_000;
const REFUSAL_MESSAGE = "访问人数较多，请稍后再试";

export function classifyPressure(sample: PressureSample, thresholds: PressureThresholds): ServerPressure {
  if (
    sample.eventLoopDelayMs >= thresholds.overloadedEventLoopDelayMs ||
    sample.poolWaiting >= thresholds.overloadedPoolWaiting
  ) {
    return "overloaded";
  }
  if (sample.eventLoopDelayMs >= thresholds.busyEventLoopDelayMs || sample.poolWaiting >= thresholds.busyPoolWaiting) {
    return "busy";
  }
  return "normal";
}

/** Raises the level at once and lowers it only after the current level has held. */
export function advancePressure(
  state: PressureState,
  measured: ServerPressure,
  now: number,
  holdMs = HOLD_MS,
): PressureState {
  if (RANK[measured] < RANK[state.level] && now < state.holdUntil) return state;
  return { level: measured, holdUntil: measured === "normal" ? 0 : now + holdMs };
}

const EXEMPT_PATHS = new Set([
  "/access-denied",
  "/api/health",
  "/api/live",
  "/api/ready",
  "/api/site-icon",
  "/api/version",
  "/favicon.ico",
]);

export function classifyRequest(method: string, pathname: string): RequestPriority {
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/_next/") ||
    EXEMPT_PATHS.has(pathname)
  ) {
    return "exempt";
  }
  if (method === "POST" && (pathname.startsWith("/api/analytics/") || pathname === "/api/search/analytics")) {
    return "background";
  }
  return "standard";
}

export function shouldShed(pressure: ServerPressure, priority: RequestPriority): boolean {
  if (priority === "exempt" || pressure === "normal") return false;
  return pressure === "overloaded" || priority === "background";
}

export type ShedReply = { status: 429 | 503; retryAfterSeconds: number; contentType: string; body: string };

/**
 * Pages the CDN may keep get 503, which lets Cloudflare answer with its stale copy
 * (`stale-if-error`) so visitors keep reading; everything else gets 429.
 */
export function shedReply(input: {
  pathname: string;
  accept: string | null;
  edgeCacheable: boolean;
  pressure: ServerPressure;
  random?: () => number;
}): ShedReply {
  const random = input.random ?? Math.random;
  // Spread retries so refused visitors do not all come back in the same second.
  const retryAfterSeconds = (input.pressure === "overloaded" ? 5 : 15) + Math.floor(random() * 5);
  const status = input.edgeCacheable ? 503 : 429;
  if (input.pathname.startsWith("/api/")) {
    return {
      status,
      retryAfterSeconds,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: false, message: REFUSAL_MESSAGE }),
    };
  }
  if (input.accept?.includes("text/html")) {
    return { status, retryAfterSeconds, contentType: "text/html; charset=utf-8", body: busyPage(retryAfterSeconds) };
  }
  return { status, retryAfterSeconds, contentType: "text/plain; charset=utf-8", body: REFUSAL_MESSAGE };
}

function busyPage(retryAfterSeconds: number): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="refresh" content="${retryAfterSeconds}"><meta name="robots" content="noindex">`
    + `<title>访问人数较多</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;`
    + `background:#f6f6f6;color:#1a1a1a;font:15px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC",`
    + `"Microsoft YaHei",sans-serif}main{max-width:32rem;padding:32px;text-align:center}h1{margin:0 0 8px;`
    + `font-size:20px}p{margin:0;color:#666}@media (prefers-color-scheme:dark){body{background:#141414;`
    + `color:#ececec}p{color:#a0a0a0}}</style></head><body><main><h1>访问人数较多</h1>`
    + `<p>服务器正忙，页面会在 ${retryAfterSeconds} 秒后自动重试。</p></main></body></html>`;
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

export function loadSheddingEnabled(): boolean {
  const value = process.env.LOAD_SHEDDING?.trim().toLowerCase();
  if (value === "on" || value === "true" || value === "1") return true;
  if (value === "off" || value === "false" || value === "0") return false;
  // Development compiles a route on its first request, which stalls the event loop for seconds.
  return process.env.NODE_ENV === "production";
}

export function pressureThresholds(poolSize: number): PressureThresholds {
  return {
    busyEventLoopDelayMs: integerSetting("LOAD_SHED_BUSY_EVENT_LOOP_MS", 100, 20, 5_000),
    overloadedEventLoopDelayMs: integerSetting("LOAD_SHED_OVERLOADED_EVENT_LOOP_MS", 250, 40, 10_000),
    busyPoolWaiting: integerSetting("LOAD_SHED_BUSY_POOL_WAITING", poolSize, 1, 10_000),
    overloadedPoolWaiting: integerSetting("LOAD_SHED_OVERLOADED_POOL_WAITING", poolSize * 4, 1, 10_000),
  };
}

export type PoolGauge = { waitingCount: number; options?: { max?: number } };

type Monitor = {
  histogram: IntervalHistogram;
  state: PressureState;
  lastSample: PressureSample;
  refused: Record<Exclude<ServerPressure, "normal">, number>;
  refusedSinceLog: number;
  lastLogAt: number;
};

const runtime = globalThis as typeof globalThis & { novelReaderLoadShedding?: Monitor };

function poolSizeOf(pool: PoolGauge): number {
  return pool.options?.max ?? 10;
}

function monitor(pool: PoolGauge): Monitor {
  if (runtime.novelReaderLoadShedding) return runtime.novelReaderLoadShedding;
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const current: Monitor = {
    histogram,
    state: { level: "normal", holdUntil: 0 },
    lastSample: { eventLoopDelayMs: 0, poolWaiting: 0 },
    refused: { busy: 0, overloaded: 0 },
    refusedSinceLog: 0,
    lastLogAt: 0,
  };
  runtime.novelReaderLoadShedding = current;
  setInterval(() => {
    // The 90th percentile of the last half second: a single GC pause does not count,
    // a loop that is behind on most ticks does.
    const eventLoopDelayMs = Number(histogram.count) ? histogram.percentile(90) / 1_000_000 : 0;
    histogram.reset();
    current.lastSample = { eventLoopDelayMs, poolWaiting: pool.waitingCount };
    const measured = classifyPressure(current.lastSample, pressureThresholds(poolSizeOf(pool)));
    current.state = advancePressure(current.state, measured, Date.now());
  }, SAMPLE_INTERVAL_MS).unref();
  return current;
}

/** The pressure a request arriving now is judged by. */
export function currentPressure(pool: PoolGauge, now = Date.now()): ServerPressure {
  const current = monitor(pool);
  // The pool can fill between samples, so its queue is also read on every request.
  const queued = classifyPressure(
    { eventLoopDelayMs: 0, poolWaiting: pool.waitingCount },
    pressureThresholds(poolSizeOf(pool)),
  );
  if (RANK[queued] > RANK[current.state.level]) current.state = advancePressure(current.state, queued, now);
  return current.state.level;
}

export function recordShed(level: ServerPressure, now = Date.now()): void {
  const current = runtime.novelReaderLoadShedding;
  if (!current || level === "normal") return;
  current.refused[level] += 1;
  current.refusedSinceLog += 1;
  if (now - current.lastLogAt < LOG_INTERVAL_MS) return;
  console.warn(JSON.stringify({
    event: "server.load-shedding",
    level,
    refused: current.refusedSinceLog,
    eventLoopDelayMs: Math.round(current.lastSample.eventLoopDelayMs),
    poolWaiting: current.lastSample.poolWaiting,
  }));
  current.refusedSinceLog = 0;
  current.lastLogAt = now;
}

export function getLoadSheddingMetrics() {
  const current = runtime.novelReaderLoadShedding;
  return {
    enabled: loadSheddingEnabled(),
    level: current?.state.level ?? "normal",
    eventLoopDelayMs: current ? Math.round(current.lastSample.eventLoopDelayMs * 10) / 10 : null,
    poolWaiting: current?.lastSample.poolWaiting ?? null,
    refused: { busy: current?.refused.busy ?? 0, overloaded: current?.refused.overloaded ?? 0 },
  };
}
