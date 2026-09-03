const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

type FormatLocalDateTimeOptions = {
  fallback?: string;
  locale?: string;
  timeZone?: string;
};

type FormatCompactUpdateDateOptions = {
  now?: number;
  timeZone?: string;
};

type RelativeTimeLabels = {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

function normalizeMilliseconds(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  return Number(value.padEnd(3, "0").slice(0, 3));
}

export function parseAppDateTime(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const sqliteTimestamp = trimmed.match(SQLITE_UTC_TIMESTAMP_PATTERN);
  if (sqliteTimestamp) {
    const [, year, month, day, hour, minute, second, milliseconds] = sqliteTimestamp;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        normalizeMilliseconds(milliseconds),
      ),
    );
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateTimeAttribute(value: string | null | undefined): string | undefined {
  return parseAppDateTime(value)?.toISOString();
}

export function formatLocalDateTime(value: string | null | undefined, options: FormatLocalDateTimeOptions = {}): string {
  const fallback = options.fallback ?? "-";
  if (!value) {
    return fallback;
  }

  const date = parseAppDateTime(value);
  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat(options.locale || "zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: options.timeZone,
  }).format(date);
}

export function formatCompactUpdateDate(
  timestamp: number,
  options: FormatCompactUpdateDateOptions = {},
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: options.timeZone,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const includeYear = (options.now ?? Date.now()) - timestamp > ONE_YEAR_MS;
  return includeYear
    ? `${value.year}-${value.month}-${value.day}`
    : `${value.month}-${value.day}`;
}

export function formatRelativeUpdateTime(
  timestamp: number,
  labels: RelativeTimeLabels,
  now = Date.now(),
): string {
  if (!Number.isFinite(timestamp)) return "-";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return labels.justNow;
  if (elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}${labels.minutesAgo}`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / (60 * 60_000)))}${labels.hoursAgo}`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / (24 * 60 * 60_000)))}${labels.daysAgo}`;
  return formatCompactUpdateDate(timestamp, { now });
}
