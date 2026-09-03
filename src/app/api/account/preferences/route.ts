import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  LOCALE_COOKIE,
  normalizeLocale,
  TRADITIONAL_LOCALE,
  type AppLocale,
} from "@/lib/locale";
import { getCurrentUser } from "@/lib/user-auth";
import {
  updateUserLocalePreference,
  updateUserReadingHistoryPreference,
  type ReadingHistoryKind,
} from "@/lib/users";

type PreferencePayload = {
  locale?: string;
  readingHistoryEnabled?: boolean;
  readingHistoryKind?: ReadingHistoryKind;
};

export async function PATCH(request: Request) {
  let payload: PreferencePayload;
  try {
    payload = await request.json() as PreferencePayload;
  } catch {
    return NextResponse.json({ ok: false, message: "设置内容无效" }, { status: 400 });
  }

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
    if (locale) {
      updateUserLocalePreference(user.id, locale);
    }
    if (hasReadingHistoryPreference) {
      updateUserReadingHistoryPreference(user.id, readingHistoryKind, Boolean(payload.readingHistoryEnabled));
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
