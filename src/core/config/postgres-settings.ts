import type { QueryResultRow } from "pg";
import { database, type SqlExecutor } from "@/core/db/postgres";

export const SITE_SETTINGS_KEY = "site";

const DEFAULT_CACHE_MAX_AGE_MS = 0;
const MAX_CACHE_MAX_AGE_MS = 5_000;
const MAX_SETTINGS_BYTES = 1_048_576;
const SETTINGS_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export type PostgresSettingsSnapshot<T> = Readonly<{
  key: string;
  value: T;
  version: number;
  updatedAt: string;
}>;

export type PostgresSettingsCodec<T> = {
  /** Parse and validate untrusted JSON read from PostgreSQL. */
  parse(value: unknown): T;
};

export type PostgresSettingsWriteResult<T> =
  | { ok: true; snapshot: PostgresSettingsSnapshot<T> }
  | { ok: false; currentVersion: number | null };

export type PostgresSettingsRepositoryOptions = {
  /**
   * Settings are fresh by default. A small cache can be enabled for unusually
   * hot call sites; staleness is then strictly bounded by this duration.
   */
  cacheMaxAgeMs?: number;
};

type SettingsRow = QueryResultRow & {
  key: string;
  value: unknown;
  version: string | number;
  updated_at: Date | string;
};

type VersionRow = QueryResultRow & {
  applied: boolean;
  key: string | null;
  value: unknown | null;
  version: string | number | null;
  updated_at: Date | string | null;
};

type CachedSnapshot<T> = {
  expiresAt: number;
  generation: number;
  snapshot: PostgresSettingsSnapshot<T> | null;
};

function validateSettingsKey(key: string): string {
  if (!SETTINGS_KEY_PATTERN.test(key)) {
    throw new Error("Invalid PostgreSQL settings key");
  }
  return key;
}

function normalizeCacheMaxAge(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CACHE_MAX_AGE_MS;
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid PostgreSQL settings cache age");
  return Math.min(Math.floor(value), MAX_CACHE_MAX_AGE_MS);
}

function positiveSafeInteger(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid PostgreSQL settings ${field}`);
  }
  return parsed;
}

function toIsoTimestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL settings ${field}`);
  return date.toISOString();
}

function jsonRoundTrip(value: unknown): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;
  function validate(item: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 32) throw new Error("PostgreSQL settings JSON is too complex");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      if (item.includes("\0") || !item.isWellFormed()) throw new Error("PostgreSQL settings must contain valid Unicode without U+0000");
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("PostgreSQL settings numbers must be finite");
      return;
    }
    if (typeof item !== "object") throw new Error("PostgreSQL settings must be valid JSON");
    if (ancestors.has(item)) throw new Error("PostgreSQL settings cannot contain circular JSON");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error("PostgreSQL settings must contain plain JSON objects");
    }
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (const child of item) validate(child, depth + 1);
    } else {
      for (const [key, child] of Object.entries(item)) {
        validate(key, depth + 1);
        validate(child, depth + 1);
      }
    }
    ancestors.delete(item);
  }
  validate(value, 0);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("PostgreSQL settings must be valid JSON");
  }
  if (serialized === undefined) throw new Error("PostgreSQL settings must be valid JSON");
  if (Buffer.byteLength(serialized, "utf8") > MAX_SETTINGS_BYTES) {
    throw new Error("PostgreSQL settings exceed the 1 MiB limit");
  }
  return JSON.parse(serialized) as unknown;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function immutableParsedValue<T>(codec: PostgresSettingsCodec<T>, value: unknown): T {
  // The JSON round-trip removes driver-owned objects and prevents callers from
  // retaining mutable references that could silently corrupt the cache.
  return deepFreeze(jsonRoundTrip(codec.parse(jsonRoundTrip(value))) as T);
}

function snapshotFromRow<T>(codec: PostgresSettingsCodec<T>, row: SettingsRow): PostgresSettingsSnapshot<T> {
  return Object.freeze({
    key: validateSettingsKey(row.key),
    value: immutableParsedValue(codec, row.value),
    version: positiveSafeInteger(row.version, "version"),
    updatedAt: toIsoTimestamp(row.updated_at, "updated_at"),
  });
}

/**
 * Async, optimistic-concurrency settings storage. It never falls back to a
 * local file and never hides malformed database state behind defaults.
 */
export class PostgresSettingsRepository<T> {
  readonly #executor: SqlExecutor;
  readonly #codec: PostgresSettingsCodec<T>;
  readonly #cacheMaxAgeMs: number;
  readonly #cache = new Map<string, CachedSnapshot<T>>();
  readonly #inflight = new Map<string, Promise<PostgresSettingsSnapshot<T> | null>>();
  readonly #generation = new Map<string, number>();

  constructor(
    codec: PostgresSettingsCodec<T>,
    executor: SqlExecutor = database("web"),
    options: PostgresSettingsRepositoryOptions = {},
  ) {
    this.#codec = codec;
    this.#executor = executor;
    this.#cacheMaxAgeMs = normalizeCacheMaxAge(options.cacheMaxAgeMs);
  }

  async read(key: string, options: { fresh?: boolean } = {}): Promise<PostgresSettingsSnapshot<T> | null> {
    const normalizedKey = validateSettingsKey(key);
    const now = Date.now();
    if (!options.fresh) {
      const cached = this.#cache.get(normalizedKey);
      if (cached && cached.expiresAt > now && cached.generation === this.#currentGeneration(normalizedKey)) {
        return cached.snapshot;
      }
      const pending = this.#inflight.get(normalizedKey);
      if (pending) return pending;
    }

    const generation = this.#currentGeneration(normalizedKey);
    const read = this.#readDatabase(normalizedKey).then((snapshot) => {
      if (this.#cacheMaxAgeMs > 0 && generation === this.#currentGeneration(normalizedKey)) {
        this.#cache.set(normalizedKey, {
          expiresAt: Date.now() + this.#cacheMaxAgeMs,
          generation,
          snapshot,
        });
      }
      return snapshot;
    }).finally(() => {
      if (this.#inflight.get(normalizedKey) === read) this.#inflight.delete(normalizedKey);
    });
    if (!options.fresh) this.#inflight.set(normalizedKey, read);
    return read;
  }

  async compareAndSet(
    key: string,
    expectedVersion: number | null,
    value: T,
  ): Promise<PostgresSettingsWriteResult<T>> {
    const normalizedKey = validateSettingsKey(key);
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw new Error("Invalid expected PostgreSQL settings version");
    }
    // Validate before the write, so invalid configuration can never become the
    // shared source of truth even when callers have loose static types.
    // Always pass encoded JSON: pg treats top-level strings and arrays as SQL
    // parameters, not JSON. Object-only mocks would hide this protocol bug.
    const jsonValue = JSON.stringify(immutableParsedValue(this.#codec, value));

    const result = expectedVersion === null
      ? await this.#executor.query<VersionRow>({
        name: "settings-insert-cas-v1",
        text: `WITH applied AS (
                 INSERT INTO site_settings (key, value, version)
                 VALUES ($1, $2::jsonb, 1)
                 ON CONFLICT (key) DO NOTHING
                 RETURNING key, value, version, updated_at
               ), current_value AS (
                 SELECT key, value, version, updated_at FROM site_settings WHERE key = $1
               )
               SELECT true AS applied, key, value, version, updated_at FROM applied
               UNION ALL
               SELECT false AS applied, key, value, version, updated_at
               FROM current_value WHERE NOT EXISTS (SELECT 1 FROM applied)
               LIMIT 1`,
        values: [normalizedKey, jsonValue],
      })
      : await this.#executor.query<VersionRow>({
        name: "settings-update-cas-v1",
        text: `WITH applied AS (
                 UPDATE site_settings
                 SET value = $3::jsonb, version = version + 1, updated_at = clock_timestamp()
                 WHERE key = $1 AND version = $2
                 RETURNING key, value, version, updated_at
               ), current_value AS (
                 SELECT key, value, version, updated_at FROM site_settings WHERE key = $1
               )
               SELECT true AS applied, key, value, version, updated_at FROM applied
               UNION ALL
               SELECT false AS applied, key, value, version, updated_at
               FROM current_value WHERE NOT EXISTS (SELECT 1 FROM applied)
               LIMIT 1`,
        values: [normalizedKey, expectedVersion, jsonValue],
      });

    this.invalidate(normalizedKey);
    const row = result.rows[0];
    if (!row?.applied) {
      return {
        ok: false,
        currentVersion: row?.version == null ? null : positiveSafeInteger(row.version, "version"),
      };
    }
    if (row.key === null || row.version === null || row.updated_at === null) {
      throw new Error("PostgreSQL settings CAS returned an incomplete row");
    }
    const snapshot = snapshotFromRow(this.#codec, row as SettingsRow);
    if (this.#cacheMaxAgeMs > 0) {
      const generation = this.#currentGeneration(normalizedKey);
      this.#cache.set(normalizedKey, {
        expiresAt: Date.now() + this.#cacheMaxAgeMs,
        generation,
        snapshot,
      });
    }
    return { ok: true, snapshot };
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      for (const cachedKey of new Set([...this.#cache.keys(), ...this.#inflight.keys(), ...this.#generation.keys()])) {
        this.#generation.set(cachedKey, this.#currentGeneration(cachedKey) + 1);
      }
      this.#cache.clear();
      this.#inflight.clear();
      return;
    }
    const normalizedKey = validateSettingsKey(key);
    this.#generation.set(normalizedKey, this.#currentGeneration(normalizedKey) + 1);
    this.#cache.delete(normalizedKey);
    this.#inflight.delete(normalizedKey);
  }

  async #readDatabase(key: string): Promise<PostgresSettingsSnapshot<T> | null> {
    const result = await this.#executor.query<SettingsRow>({
      name: "settings-read-v1",
      text: `SELECT key, value, version, updated_at
             FROM site_settings
             WHERE key = $1`,
      values: [key],
    });
    const row = result.rows[0];
    return row ? snapshotFromRow(this.#codec, row) : null;
  }

  #currentGeneration(key: string): number {
    return this.#generation.get(key) ?? 0;
  }
}
