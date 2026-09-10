import { defaultSiteSettings, type SiteSettings } from "./site-settings-schema";
import { readFreshPostgresSiteSettingsSnapshot } from "./site-settings";

type RuntimeSettingsState = {
  value?: SiteSettings;
  version?: number;
  refresh?: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
};

const state = globalThis as typeof globalThis & { novelReaderRuntimeSettings?: RuntimeSettingsState };
const REFRESH_INTERVAL_MS = 2_000;

function runtimeState(): RuntimeSettingsState {
  state.novelReaderRuntimeSettings ||= {};
  return state.novelReaderRuntimeSettings;
}

export function installRuntimeSiteSettings(value: SiteSettings, version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid runtime site-settings version");
  const current = runtimeState();
  if ((current.version ?? 0) > version) return;
  current.value = Object.freeze({ ...value });
  current.version = version;
}

export function readRuntimeSiteSettings(): SiteSettings {
  const value = runtimeState().value;
  if (value) return value;
  if (process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT) return defaultSiteSettings();
  throw new Error("PostgreSQL site settings are not loaded");
}

export async function refreshRuntimeSiteSettings(): Promise<void> {
  const current = runtimeState();
  if (current.refresh) return current.refresh;
  current.refresh = (async () => {
    const snapshot = await readFreshPostgresSiteSettingsSnapshot();
    installRuntimeSiteSettings(snapshot.value, snapshot.version);
  })().finally(() => {
    current.refresh = undefined;
  });
  return current.refresh;
}

export async function initializeRuntimeSiteSettings(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  await refreshRuntimeSiteSettings();
  const current = runtimeState();
  if (current.timer) return;
  current.timer = setInterval(() => {
    void refreshRuntimeSiteSettings().catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "postgres.settings.refresh.failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }, REFRESH_INTERVAL_MS);
  current.timer.unref?.();
}
