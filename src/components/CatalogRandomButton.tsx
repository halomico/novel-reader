"use client";

import { ChevronRight, Dices, LockKeyhole } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { localeFromPathname, uiText, withLocalePath } from "@/lib/locale";
import { beginNavigationProgress } from "./NavigationProgress";

function randomCatalogHref(basePath: string, searchParams?: URLSearchParams) {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const params = new URLSearchParams({ random: seed });
  if (basePath === "/novels" && searchParams) {
    const library = searchParams.get("library") || searchParams.get("sourceLibrary") || "";
    const access = searchParams.get("access") || "";
    if (library && library !== "default") params.set("library", library);
    if (access === "free" || access === "soda") params.set("access", access);
  }
  return `${basePath}?${params.toString()}`;
}

export function CatalogRandomButton({ basePath = "/novels" }: { basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = localeFromPathname(usePathname());
  const label = uiText(locale, "随便看看");

  function openRandomSelection() {
    beginNavigationProgress();
    router.push(withLocalePath(randomCatalogHref(basePath, new URLSearchParams(searchParams.toString())), locale));
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
    const href = randomCatalogHref("/novels");
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
