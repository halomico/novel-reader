import { monitorEventLoopDelay, performance, type IntervalHistogram } from "node:perf_hooks";

export type ServerTimingMetric = {
  name: string;
  durationMs: number;
  description?: string;
};

export type RuntimeMetrics = {
  processStartedAt: string;
  uptimeSeconds: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  eventLoop: {
    resolutionMs: number;
    samples: number;
    meanMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
};

type RuntimeState = {
  histogram?: IntervalHistogram;
  processStartedAt?: string;
  resolutionMs?: number;
};

const runtimeState = globalThis as typeof globalThis & {
  novelReaderRuntimeMetrics?: RuntimeState;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function milliseconds(nanoseconds: number): number | null {
  const value = nanoseconds / 1_000_000;
  return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : null;
}

export function initializeRuntimeMetrics(): void {
  const current = runtimeState.novelReaderRuntimeMetrics ||= {};
  if (current.histogram) return;
  const resolutionMs = boundedInteger(process.env.EVENT_LOOP_METRICS_RESOLUTION_MS, 20, 10, 1_000);
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  current.histogram = histogram;
  current.resolutionMs = resolutionMs;
  current.processStartedAt = new Date(Date.now() - Math.round(process.uptime() * 1_000)).toISOString();
}

export function getRuntimeMetrics(): RuntimeMetrics {
  initializeRuntimeMetrics();
  const current = runtimeState.novelReaderRuntimeMetrics!;
  const histogram = current.histogram!;
  const memory = process.memoryUsage();
  const samples = Number(histogram.count);
  return {
    processStartedAt: current.processStartedAt!,
    uptimeSeconds: Math.round(process.uptime() * 10) / 10,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    eventLoop: {
      resolutionMs: current.resolutionMs!,
      samples,
      meanMs: samples ? milliseconds(histogram.mean) : null,
      p50Ms: samples ? milliseconds(histogram.percentile(50)) : null,
      p95Ms: samples ? milliseconds(histogram.percentile(95)) : null,
      p99Ms: samples ? milliseconds(histogram.percentile(99)) : null,
      maxMs: samples ? milliseconds(histogram.max) : null,
    },
  };
}

function timingToken(value: string): string {
  const token = value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 64);
  return token || "operation";
}

function timingDescription(value: string): string {
  return value.replace(/["\\\u0000-\u001f\u007f]/gu, "_").slice(0, 128);
}

export function formatServerTiming(metrics: readonly ServerTimingMetric[]): string {
  return metrics
    .filter((metric) => Number.isFinite(metric.durationMs) && metric.durationMs >= 0)
    .map((metric) => {
      const description = metric.description
        ? `;desc="${timingDescription(metric.description)}"`
        : "";
      return `${timingToken(metric.name)};dur=${metric.durationMs.toFixed(1)}${description}`;
    })
    .join(", ");
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}
