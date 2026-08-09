import { type NextRequest, NextResponse } from "next/server";
import { removeMediaFavorites, removeNovelFavorites } from "@/lib/favorites";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

type FavoriteKind = "novel" | "video" | "audio";

function isFavoriteKind(value: unknown): value is FavoriteKind {
  return value === "novel" || value === "video" || value === "audio";
}

export async function DELETE(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  let body: { kind?: unknown; ids?: unknown };
  try {
    body = await request.json() as { kind?: unknown; ids?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "请求内容无效" }, { status: 400 });
  }
  if (!isFavoriteKind(body.kind) || !Array.isArray(body.ids)) {
    return NextResponse.json({ ok: false, message: "请选择收藏内容" }, { status: 400 });
  }
  const ids = body.ids.map(Number);
  const removed = body.kind === "novel"
    ? removeNovelFavorites(user.id, ids)
    : removeMediaFavorites(user.id, body.kind, ids);
  return NextResponse.json(
    { ok: true, removed },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
