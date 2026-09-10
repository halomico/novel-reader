import { withTransaction } from "./postgres";
import { defaultSiteSettings } from "@/core/config/site-settings-schema";

/** Explicit deployment initialization, never called from a user request. Existing
 * configuration and administrator-customized levels are preserved on every run. */
export async function initializePostgresApplication(transaction = withTransaction): Promise<{
  settingsCreated: boolean; sourceCreated: boolean; levelsCreated: number;
}> {
  return transaction(async (tx) => {
    await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('novel-reader-bootstrap-v1', 0))" });
    const settings = await tx.query({
      text: "INSERT INTO site_settings (key, value, version) VALUES ('site', $1::jsonb, 1) ON CONFLICT (key) DO NOTHING",
      values: [JSON.stringify(defaultSiteSettings())],
    });
    const source = await tx.query({
      text: `INSERT INTO novel_sources (slug, name, relative_path)
        VALUES ('default', '默认来源', '') ON CONFLICT DO NOTHING`,
    });
    const levels = await tx.query({
      text: `INSERT INTO user_levels
        (level, name, soda_required, daily_video_download_limit, video_concurrency_limit, permissions)
        VALUES
          (0, '访客', 0, 0, 0, '[]'::jsonb),
          (1, '初见', 0, 3, 1, '["video_download"]'::jsonb),
          (2, '熟客', 50, 5, 2, '["advanced_search","market_access","video_download"]'::jsonb),
          (3, '常驻', 200, 8, 2, '["advanced_search","market_access","video_download"]'::jsonb),
          (4, '活跃', 500, 12, 2, '["advanced_search","market_access","video_download"]'::jsonb),
          (5, '资深', 1200, 20, 3, '["advanced_search","market_access","video_download"]'::jsonb),
          (6, '核心', 2500, 30, 3, '["advanced_search","market_access","video_download"]'::jsonb)
        ON CONFLICT (level) DO NOTHING`,
    });
    const sourceCheck = await tx.query({
      text: "SELECT id FROM novel_sources WHERE lower(slug) = 'default'",
    });
    if (!sourceCheck.rowCount) throw new Error("Default source path conflicts with another source; initialization rolled back");
    return { settingsCreated: settings.rowCount === 1, sourceCreated: source.rowCount === 1, levelsCreated: levels.rowCount ?? 0 };
  }, { role: "jobs" });
}
