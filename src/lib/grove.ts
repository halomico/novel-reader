import { listNovelsByIds, type Novel } from "./books";
import { getDb } from "./db";
import { listMediaAssetsByIds, type FeedbackMediaKind, type MediaAsset } from "./media";

export type GroveKind = "novel" | FeedbackMediaKind;
export type GroveStage = "seed" | "sprout" | "tree";

export type GroveState = {
  planted: boolean;
  visitCount: number;
  stage: GroveStage;
};

type GroveItemBase = {
  id: number;
  title: string;
  visitCount: number;
  stage: GroveStage;
  plantedAt: string;
};

export type GroveNovelItem = GroveItemBase & {
  kind: "novel";
  storageMode: Novel["storage_mode"];
  chapterCount: number;
  wordCount: number;
};

export type GroveMediaItem = GroveItemBase & {
  kind: FeedbackMediaKind;
  fileName: string;
  artist: string;
  durationSeconds: number | null;
};

export type GroveItem = GroveNovelItem | GroveMediaItem;

export type GroveStats = {
  all: number;
  seed: number;
  sprout: number;
  tree: number;
};

export type GrovePage = {
  items: GroveItem[];
  stats: GroveStats;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type GroveIndexRow = {
  kind: GroveKind;
  item_id: number;
  visit_count: number;
  created_at: string;
};

const GROVE_CTE = `WITH grove AS (
  SELECT 'novel' AS kind, novel_id AS item_id, visit_count, created_at
  FROM user_novel_grove
  WHERE user_id = ?
  UNION ALL
  SELECT m.kind AS kind, g.media_id AS item_id, g.visit_count, g.created_at
  FROM user_media_grove g
  INNER JOIN media_assets m ON m.id = g.media_id
  WHERE g.user_id = ? AND m.kind IN ('video', 'audio')
)`;

export function groveStageForVisitCount(value: number): GroveStage {
  const visitCount = Math.max(Math.floor(Number(value) || 0), 0);
  if (visitCount >= 10) return "tree";
  if (visitCount >= 3) return "sprout";
  return "seed";
}

export function normalizeGroveStage(value: string | undefined): GroveStage | null {
  return value === "seed" || value === "sprout" || value === "tree" ? value : null;
}

function stateFromRow(row: { visit_count: number } | undefined): GroveState {
  const visitCount = Math.max(Math.floor(row?.visit_count || 0), 0);
  return {
    planted: Boolean(row),
    visitCount,
    stage: groveStageForVisitCount(visitCount),
  };
}

export function getNovelGroveState(userId: number, novelId: number): GroveState {
  const row = getDb()
    .prepare("SELECT visit_count FROM user_novel_grove WHERE user_id = ? AND novel_id = ?")
    .get(userId, novelId) as { visit_count: number } | undefined;
  return stateFromRow(row);
}

export function toggleNovelGrove(userId: number, novelId: number): { ok: boolean } & GroveState {
  const db = getDb();
  const removed = db
    .prepare("DELETE FROM user_novel_grove WHERE user_id = ? AND novel_id = ?")
    .run(userId, novelId);
  if (removed.changes > 0) {
    return { ok: true, ...stateFromRow(undefined) };
  }
  const added = db
    .prepare(
      `INSERT INTO user_novel_grove (user_id, novel_id, visit_count)
       SELECT ?, id, 0 FROM novels WHERE id = ?`,
    )
    .run(userId, novelId);
  return { ok: added.changes > 0, ...getNovelGroveState(userId, novelId) };
}

export function recordNovelGroveVisit(userId: number, novelId: number): boolean {
  return getDb()
    .prepare(
      `UPDATE user_novel_grove
       SET visit_count = visit_count + 1
       WHERE user_id = ? AND novel_id = ?`,
    )
    .run(userId, novelId).changes > 0;
}

export function getMediaGroveState(userId: number, mediaId: number): GroveState {
  const row = getDb()
    .prepare("SELECT visit_count FROM user_media_grove WHERE user_id = ? AND media_id = ?")
    .get(userId, mediaId) as { visit_count: number } | undefined;
  return stateFromRow(row);
}

export function toggleMediaGrove(userId: number, mediaId: number): { ok: boolean } & GroveState {
  const db = getDb();
  const removed = db
    .prepare("DELETE FROM user_media_grove WHERE user_id = ? AND media_id = ?")
    .run(userId, mediaId);
  if (removed.changes > 0) {
    return { ok: true, ...stateFromRow(undefined) };
  }
  const added = db
    .prepare(
      `INSERT INTO user_media_grove (user_id, media_id, visit_count)
       SELECT ?, id, 0 FROM media_assets WHERE id = ? AND kind IN ('video', 'audio')`,
    )
    .run(userId, mediaId);
  return { ok: added.changes > 0, ...getMediaGroveState(userId, mediaId) };
}

export function recordMediaGroveVisit(userId: number, mediaId: number): boolean {
  return getDb()
    .prepare(
      `UPDATE user_media_grove
       SET visit_count = visit_count + 1
       WHERE user_id = ? AND media_id = ?`,
    )
    .run(userId, mediaId).changes > 0;
}

function normalizeAllowedKinds(values: readonly GroveKind[] | undefined): GroveKind[] {
  const allowed = values === undefined ? ["novel", "video", "audio"] : values;
  return Array.from(new Set(allowed)).filter(
    (kind): kind is GroveKind => kind === "novel" || kind === "video" || kind === "audio",
  );
}

function stagePredicate(stage: GroveStage | null): string {
  if (stage === "seed") return "visit_count < 3";
  if (stage === "sprout") return "visit_count BETWEEN 3 AND 9";
  if (stage === "tree") return "visit_count >= 10";
  return "1 = 1";
}

function mapGroveItems(rows: GroveIndexRow[]): GroveItem[] {
  const novels = new Map(listNovelsByIds(
    rows.filter((row) => row.kind === "novel").map((row) => row.item_id),
  ).map((book) => [book.id, book]));
  const media = new Map(listMediaAssetsByIds(
    rows.filter((row) => row.kind !== "novel").map((row) => row.item_id),
  ).map((asset) => [asset.id, asset]));

  const items: GroveItem[] = [];
  for (const row of rows) {
    const visitCount = Math.max(Math.floor(row.visit_count || 0), 0);
    const base = {
      id: row.item_id,
      visitCount,
      stage: groveStageForVisitCount(visitCount),
      plantedAt: row.created_at,
    };
    if (row.kind === "novel") {
      const book = novels.get(row.item_id);
      if (book) {
        items.push({
          ...base,
          kind: "novel",
          title: book.title,
          storageMode: book.storage_mode,
          chapterCount: book.chapter_count,
          wordCount: book.word_count,
        });
      }
      continue;
    }
    const asset = media.get(row.item_id) as MediaAsset | undefined;
    if (asset && (asset.kind === "video" || asset.kind === "audio")) {
      items.push({
        ...base,
        kind: asset.kind,
        title: asset.title,
        fileName: asset.fileName,
        artist: asset.artist,
        durationSeconds: asset.durationSeconds,
      });
    }
  }
  return items;
}

export function listGrovePage(
  userId: number,
  params: {
    stage?: GroveStage | null;
    allowedKinds?: readonly GroveKind[];
    page?: number;
    pageSize?: number;
  } = {},
): GrovePage {
  const db = getDb();
  const allowedKinds = normalizeAllowedKinds(params.allowedKinds);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 24), 1), 100);
  if (!allowedKinds.length) {
    return {
      items: [],
      stats: { all: 0, seed: 0, sprout: 0, tree: 0 },
      page: 1,
      pageSize,
      totalItems: 0,
      totalPages: 1,
    };
  }

  const kindPlaceholders = allowedKinds.map(() => "?").join(", ");
  const baseValues = [userId, userId, ...allowedKinds];
  const stats = db.prepare(
    `${GROVE_CTE}
     SELECT COUNT(*) AS all_count,
            COALESCE(SUM(CASE WHEN visit_count < 3 THEN 1 ELSE 0 END), 0) AS seed_count,
            COALESCE(SUM(CASE WHEN visit_count BETWEEN 3 AND 9 THEN 1 ELSE 0 END), 0) AS sprout_count,
            COALESCE(SUM(CASE WHEN visit_count >= 10 THEN 1 ELSE 0 END), 0) AS tree_count
     FROM grove
     WHERE kind IN (${kindPlaceholders})`,
  ).get(...baseValues) as {
    all_count: number;
    seed_count: number;
    sprout_count: number;
    tree_count: number;
  };
  const predicate = stagePredicate(params.stage || null);
  const total = db.prepare(
    `${GROVE_CTE}
     SELECT COUNT(*) AS count
     FROM grove
     WHERE kind IN (${kindPlaceholders}) AND ${predicate}`,
  ).get(...baseValues) as { count: number };
  const totalPages = Math.max(Math.ceil(total.count / pageSize), 1);
  const requestedPage = Number.isFinite(params.page) ? Math.floor(params.page || 1) : 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const rows = db.prepare(
    `${GROVE_CTE}
     SELECT kind, item_id, visit_count, created_at
     FROM grove
     WHERE kind IN (${kindPlaceholders}) AND ${predicate}
     ORDER BY created_at DESC, kind ASC, item_id DESC
     LIMIT ? OFFSET ?`,
  ).all(...baseValues, pageSize, (page - 1) * pageSize) as GroveIndexRow[];

  return {
    items: mapGroveItems(rows),
    stats: {
      all: stats.all_count,
      seed: stats.seed_count,
      sprout: stats.sprout_count,
      tree: stats.tree_count,
    },
    page,
    pageSize,
    totalItems: total.count,
    totalPages,
  };
}
