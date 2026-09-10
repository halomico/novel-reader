import { cookies } from "next/headers";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { database } from "@/core/db/postgres";
import { updatePostgresUserPreferences } from "@/domains/identity/postgres-account";
import { NextResponse } from "next/server";
import {
  LOCALE_COOKIE,
  normalizeLocale,
  TRADITIONAL_LOCALE,
  type AppLocale,
} from "@/lib/locale";
import { getCurrentUser } from "@/lib/user-auth";

type ReadingHistoryKind = "novel" | "original";

type PreferencePayload = {
  locale?: string;
  readingHistoryEnabled?: boolean;
  readingHistoryKind?: ReadingHistoryKind;
};

export async function PATCH(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<PreferencePayload>(request, 8 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.reason === "too_large" ? "设置内容过大" : "设置内容无效" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const payload = parsed.value;

  const hasLocale = payload.locale === "zh-Hans" || payload.locale === TRADITIONAL_LOCALE;
  const readingHistoryKind = payload.readingHistoryKind === "original"
    ? "original"
    : payload.readingHistoryKind === undefined || payload.readingHistoryKind === "novel"
      ? "novel"
      : null;
  if (typeof payload.readingHistoryEnabled === "boolean" && readingHistoryKind === null) {
    return NextResponse.json({ ok: false, message: "阅读类型无效" }, { status: 400 });
  }
  const hasReadingHistoryPreference = typeof payload.readingHistoryEnabled === "boolean" && readingHistoryKind !== null;
  if (!hasLocale && !hasReadingHistoryPreference) {
    return NextResponse.json({ ok: false, message: "没有可更新的设置" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (hasReadingHistoryPreference && !user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const locale = hasLocale ? normalizeLocale(payload.locale) : null;
  if (user) {
    const updated = await updatePostgresUserPreferences(database("web"), user.id, {
      localePreference: locale,
      readingHistoryKind: hasReadingHistoryPreference ? readingHistoryKind : null,
      readingHistoryEnabled: hasReadingHistoryPreference ? Boolean(payload.readingHistoryEnabled) : undefined,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, message: "账号不存在或已注销" }, { status: 404 });
    }
  }

  if (locale) {
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, locale as AppLocale, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      locale,
      readingHistoryEnabled: hasReadingHistoryPreference
        ? Boolean(payload.readingHistoryEnabled)
        : undefined,
      readingHistoryKind: hasReadingHistoryPreference ? readingHistoryKind : undefined,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
