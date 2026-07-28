"use client";

import { ChevronRight, Dices, LockKeyhole } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { localeFromPathname, uiText, withLocalePath } from "@/lib/locale";
import { beginNavigationProgress } from "./NavigationProgress";

function randomCatalogHref() {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `/novels?random=${encodeURIComponent(seed)}`;
}

export function CatalogRandomButton() {
  const router = useRouter();
  const locale = localeFromPathname(usePathname());
  const label = uiText(locale, "随便看看");

  function openRandomSelection() {
    beginNavigationProgress();
    router.push(withLocalePath(randomCatalogHref(), locale));
  }

  return (
    <button
      className="catalogRandomButton"
      type="button"
      aria-label={label}
      title={label}
      onClick={openRandomSelection}
    >
      <Dices size={18} aria-hidden="true" />
    </button>
  );
}

export function CatalogRandomCard({ loginRequired = false }: { loginRequired?: boolean }) {
  const router = useRouter();
  const locale = localeFromPathname(usePathname());
  const randomLabel = uiText(locale, "随便看看");
  const loginLabel = uiText(locale, "登录后可用");

  function openRandomSelection() {
    beginNavigationProgress();
    const href = randomCatalogHref();
    const target = loginRequired ? `/login?${new URLSearchParams({ returnTo: href }).toString()}` : href;
    router.push(withLocalePath(target, locale));
  }

  return (
    <button
      className="homePortalCard is-random"
      type="button"
      onClick={openRandomSelection}
      title={loginRequired ? loginLabel : undefined}
      aria-label={loginRequired ? `${randomLabel}，${loginLabel}` : undefined}
    >
      <span className="homePortalCardIcon" aria-hidden="true">
        <Dices size={30} />
      </span>
      <strong>{randomLabel}</strong>
      {loginRequired
        ? <LockKeyhole className="homePortalCardArrow" size={17} aria-hidden="true" />
        : <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />}
    </button>
  );
}
