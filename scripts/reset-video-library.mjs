import { DatabaseSync } from "node:sqlite";

const BATCH_SIZE = 400;
const PRESERVE_IDS = new Set([11, 12, 13, 14, 15, 16, 1767, 1768]);
const PRESERVE_CATEGORY_NAMES = new Set(["晴天小猪", "蔥宝", "葱宝", "美美子"]);

function batches(items, size) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function registry() {
  const parsed = JSON.parse(process.env.MEDIA_NODES_JSON || "[]");
  return new Map(parsed.map((node) => [node.id, node]));
}

async function deleteRemoteAssets(node, rows) {
  const response = await fetch(`${node.controlUrl}/control/assets/delete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${node.controlSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      storedNames: rows.map((row) => row.stored_name),
      playbackMediaIds: Object.fromEntries(rows.map((row) => [row.stored_name, row.id])),
    }),
  });
  if (!response.ok) {
    throw new Error(`媒体节点 ${node.id} 删除请求失败：HTTP ${response.status}`);
  }
  const result = await response.json();
  const deleted = new Set(Array.isArray(result.deletedStoredNames) ? result.deletedStoredNames : []);
  if (deleted.size !== rows.length) {
    throw new Error(`媒体节点 ${node.id} 删除不完整：请求 ${rows.length}，完成 ${deleted.size}`);
  }
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || "/app/data/novels.db";
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 30000");
  const nodes = registry();
  const preserveRows = db.prepare(
    `SELECT a.id, a.title, a.category_id, c.name AS category_name, a.storage_node_id
     FROM media_assets a
     LEFT JOIN video_categories c ON c.id = a.category_id
     WHERE a.kind = 'video' AND c.name IN ('晴天小猪', '蔥宝', '葱宝', '美美子')
     ORDER BY a.id`,
  ).all();
  const actual = [...new Set(preserveRows.map((row) => Number(row.id)))].sort((a, b) => a - b);
  const expected = [...PRESERVE_IDS].sort((a, b) => a - b);
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`保留白名单不匹配，拒绝清理：实际=${actual.join(",")}，预期=${expected.join(",")}`);
  }
  if (preserveRows.some((row) => !PRESERVE_CATEGORY_NAMES.has(row.category_name))) {
    throw new Error("保留记录存在未识别分类，拒绝清理");
  }

  const rows = db.prepare(
    `SELECT id, storage_node_id, stored_name
     FROM media_assets
     WHERE kind = 'video' AND id NOT IN (${expected.map(() => "?").join(",")})
     ORDER BY id`,
  ).all(...expected);
  console.log(JSON.stringify({ phase: "validated", totalVideos: rows.length + expected.length, deleteVideos: rows.length, preserved: preserveRows }, null, 2));

  let deleted = 0;
  for (const [batchIndex, batch] of batches(rows, BATCH_SIZE).entries()) {
    const byNode = new Map();
    for (const row of batch) {
      const nodeId = row.storage_node_id || process.env.MEDIA_LEGACY_NODE_ID;
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`视频 ${row.id} 的媒体节点未配置：${nodeId || "(empty)"}`);
      byNode.set(node.id, [...(byNode.get(node.id) || []), row]);
    }
    for (const [nodeId, nodeRows] of byNode) {
      await deleteRemoteAssets(nodes.get(nodeId), nodeRows);
    }
    const ids = batch.map((row) => row.id);
    db.prepare(`DELETE FROM media_assets WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    deleted += ids.length;
    console.log(JSON.stringify({ phase: "delete", batch: batchIndex + 1, batches: Math.ceil(rows.length / BATCH_SIZE), deleted }));
  }

  const remaining = db.prepare("SELECT id FROM media_assets WHERE kind = 'video' ORDER BY id").all().map((row) => Number(row.id));
  if (remaining.length !== expected.length || remaining.some((id) => !PRESERVE_IDS.has(id))) {
    throw new Error(`清理后视频记录不符合白名单：${remaining.join(",")}`);
  }
  const categories = db.prepare("SELECT id, name FROM video_categories ORDER BY id").all();
  const deletedCategories = [];
  for (const category of categories) {
    if (PRESERVE_CATEGORY_NAMES.has(category.name)) continue;
    db.prepare("DELETE FROM video_categories WHERE id = ?").run(category.id);
    deletedCategories.push(category.name);
  }
  db.prepare("UPDATE media_assets SET download_soda_price = 1, updated_at = CURRENT_TIMESTAMP WHERE kind = 'video'").run();
  console.log(JSON.stringify({ phase: "complete", deleted, preserved: remaining, deletedCategories }));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
