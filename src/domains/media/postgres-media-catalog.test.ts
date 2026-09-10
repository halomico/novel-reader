import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getPostgresMediaAsset, listPostgresMediaAssets, listPostgresMediaFolderAssets } from "./postgres-media-catalog";

function executor(rows: QueryResultRow[], captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

const mediaRow = {
  id: "8", kind: "audio", storage_node_id: null, category_id: null, title: "轨道", artist: "作者",
  description: "简介", file_name: "track.mp3", stored_name: "audio/album/track.mp3", mime_type: "audio/mpeg",
  size_bytes: "2048", mtime_ms: "1000", duration_seconds: "12.5", thumbnail_version: "0", custom_cover_key: null,
  playback_format: "mp4", playback_version: "", playback_manifest_path: null, playback_status: "none", playback_error: "",
  playback_published_at: null, play_count: "4", recommend_count: "2", download_count: "1",
  published_at: new Date("2026-09-01T00:00:00Z"), content_updated_at: new Date("2026-09-02T00:00:00Z"),
  new_until: null, play_soda_price: "0", download_soda_price: "1",
  created_at: new Date("2026-09-01T00:00:00Z"), updated_at: new Date("2026-09-02T00:00:00Z"),
};

test("PostgreSQL media assets normalize bigint and timestamp fields", async () => {
  const captured: SqlQuery[] = [];
  const asset = await getPostgresMediaAsset(executor([mediaRow], captured), 8);
  assert.equal(asset?.id, 8);
  assert.equal(asset?.folder, "album");
  assert.equal(asset?.durationSeconds, 12.5);
  assert.equal(asset?.updatedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(captured[0].name, "media-get-asset-v1");
});

test("PostgreSQL media listing applies implicit-AND terms before one-query pagination", async () => {
  const captured: SqlQuery[] = [];
  const result = await listPostgresMediaAssets(executor([{ ...mediaRow, total_assets: "1", total_pages: "1", page: "1" }], captured), {
    kind: "audio", folder: "album", query: "中文 现场", page: 1, pageSize: 20, sortBy: "duration", sortOrder: "desc",
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(captured[0].values, ["audio", "audio/album/%", "%中文%", "%现场%", 1, 20]);
  assert.match(captured[0].text, /ILIKE \$3[\s\S]*ILIKE \$4/u);
  assert.match(captured[0].text, /LEFT JOIN LATERAL/u);
  assert.match(captured[0].text, /duration_seconds DESC NULLS LAST/u);
});

test("PostgreSQL audio queues select every direct sibling in the same folder", async () => {
  const captured: SqlQuery[] = [];
  const assets = await listPostgresMediaFolderAssets(executor([mediaRow, { ...mediaRow, id: "9" }], captured), "audio", "album", 2_000);
  assert.deepEqual(assets.map((asset) => asset.id), [8, 9]);
  assert.deepEqual(captured[0].values, ["audio", "audio/album/%", 13, 2_000]);
  assert.match(captured[0].text, /substring\(stored_name FROM \$3::integer\)/u);
});
