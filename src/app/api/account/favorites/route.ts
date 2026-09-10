import { type NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { removePostgresNovelFavorites } from "@/domains/reading/postgres-reader-interactions";
import { removePostgresMediaFavorites, removePostgresOriginalFavorites } from "@/domains/activity/postgres-favorites";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

type FavoriteKind = "novel" | "original" | "video" | "audio";

function isFavoriteKind(value: unknown): value is FavoriteKind {
  return value === "novel" || value === "original" || value === "video" || value === "audio";
}

export async function DELETE(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const parsed = await readJsonBody<{ kind?: unknown; ids?: unknown }>(request, 64 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "请求内容无效" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsed.value;
  if (!isFavoriteKind(body.kind) || !Array.isArray(body.ids)) {
    return NextResponse.json({ ok: false, message: "请选择收藏内容" }, { status: 400 });
  }
  if (body.ids.length > 500 || body.ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) {
    return NextResponse.json({ ok: false, message: "收藏编号无效" }, { status: 400 });
  }
  const ids = [...new Set(body.ids)];
  const removed = body.kind === "novel"
    ? await removePostgresNovelFavorites(database("web"), user.id, ids)
    : body.kind === "original"
      ? await removePostgresOriginalFavorites(database("web"), user.id, ids)
      : await removePostgresMediaFavorites(database("web"), user.id, body.kind, ids);
  return NextResponse.json(
    { ok: true, removed },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
