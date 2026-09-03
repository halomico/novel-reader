import fs from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { originalAssetRoot } from "@/features/original-editor/server";
import { getDb } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tableExists(name: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasPaidAccess(userId: number, articleId: number): boolean {
  const db = getDb();
  for (const table of ["original_article_purchases", "original_purchases"]) {
    if (!tableExists(table)) continue;
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
    const articleColumn = columns.has("article_id") ? "article_id" : columns.has("original_article_id") ? "original_article_id" : "";
    const userColumn = columns.has("buyer_id") ? "buyer_id" : columns.has("user_id") ? "user_id" : "";
    if (!articleColumn || !userColumn) continue;
    return Boolean(db.prepare(
      `SELECT 1 AS found FROM ${table} WHERE ${articleColumn} = ? AND ${userColumn} = ? LIMIT 1`,
    ).get(articleId, userId));
  }
  return false;
}

function safeAssetPath(storagePath: string): string | null {
  const root = originalAssetRoot();
  try {
    const realRoot = fs.realpathSync(root);
    const candidate = path.resolve(realRoot, storagePath);
    const realTarget = fs.realpathSync(candidate);
    if (realTarget === realRoot || !realTarget.startsWith(`${realRoot}${path.sep}`)) return null;
    if (!fs.statSync(realTarget).isFile()) return null;
    return realTarget;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
  const asset = getDb().prepare(
    `SELECT a.owner_id, a.article_id, a.storage_path, a.mime_type, a.size_bytes, a.access_scope,
            o.author_id
     FROM original_assets a
     LEFT JOIN original_articles o ON o.id = a.article_id
     WHERE a.id = ?`,
  ).get(id) as {
    owner_id: number;
    article_id: number | null;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    access_scope: "draft" | "public" | "paid";
    author_id: number | null;
  } | undefined;
  if (!asset) return new NextResponse(null, { status: 404 });
  const user = getCurrentUserFromRequest(request);
  const owner = Boolean(user && (user.role === "admin" || user.id === asset.owner_id || user.id === asset.author_id));
  const allowed = asset.access_scope === "public" || owner || Boolean(
    user && asset.access_scope === "paid" && asset.article_id && hasPaidAccess(user.id, asset.article_id),
  );
  if (!allowed) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const filePath = safeAssetPath(asset.storage_path);
  if (!filePath) return new NextResponse(null, { status: 404 });
  const body = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(body.length),
      "Cache-Control": asset.access_scope === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
