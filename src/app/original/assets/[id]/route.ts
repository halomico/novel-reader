import fs from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { type NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { originalAssetRoot } from "@/domains/originals/asset-storage";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AssetRow = QueryResultRow & {
  owner_id: string | number;
  article_id: string | number | null;
  storage_path: string;
  mime_type: string;
  access_scope: "draft" | "public" | "paid";
  author_id: string | number | null;
  paid_access: boolean;
};

function safeAssetPath(storagePath: string): string | null {
  const root = originalAssetRoot();
  try {
    const realRoot = fs.realpathSync(root);
    const candidate = path.resolve(realRoot, storagePath);
    const realTarget = fs.realpathSync(candidate);
    if (realTarget === realRoot || !realTarget.startsWith(realRoot + path.sep)) return null;
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
  const user = await getCurrentUserFromRequest(request);
  const result = await database("web").query<AssetRow>({
    text: `SELECT asset.owner_id, asset.article_id, asset.storage_path, asset.mime_type,
      asset.access_scope, article.author_id,
      EXISTS (
        SELECT 1 FROM original_purchases purchase
        WHERE purchase.article_id = asset.article_id AND purchase.buyer_id = $2
      ) AS paid_access
      FROM original_assets asset
      LEFT JOIN original_articles article ON article.id = asset.article_id
      WHERE asset.id = $1`,
    values: [id, user?.id ?? 0],
  });
  const asset = result.rows[0];
  if (!asset) return new NextResponse(null, { status: 404 });
  const ownerId = Number(asset.owner_id);
  const authorId = asset.author_id == null ? null : Number(asset.author_id);
  const owner = Boolean(user && (user.role === "admin" || user.id === ownerId || user.id === authorId));
  const allowed = asset.access_scope === "public" || owner || Boolean(
    user && asset.access_scope === "paid" && asset.article_id && asset.paid_access,
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
