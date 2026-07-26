"use client";

import { ChevronRight, Dices, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { beginNavigationProgress } from "./NavigationProgress";

function randomCatalogHref() {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `/novels?random=${encodeURIComponent(seed)}`;
}

export function CatalogRandomButton() {
  const router = useRouter();

  function openRandomSelection() {
    beginNavigationProgress();
    router.push(randomCatalogHref());
  }

  return (
    <button
      className="catalogRandomButton"
      type="button"
      aria-label="随便看看"
      title="随便看看"
      onClick={openRandomSelection}
    >
      <Dices size={18} aria-hidden="true" />
    </button>
  );
}

export function CatalogRandomCard({ loginRequired = false }: { loginRequired?: boolean }) {
  const router = useRouter();

  function openRandomSelection() {
    beginNavigationProgress();
    const href = randomCatalogHref();
    router.push(loginRequired ? `/login?${new URLSearchParams({ returnTo: href }).toString()}` : href);
  }

  return (
    <button
      className="homePortalCard is-random"
      type="button"
      onClick={openRandomSelection}
      title={loginRequired ? "登录后可用" : undefined}
      aria-label={loginRequired ? "随便看看，登录后可用" : undefined}
    >
      <span className="homePortalCardIcon" aria-hidden="true">
        <Dices size={30} />
      </span>
      <strong>随便看看</strong>
      {loginRequired
        ? <LockKeyhole className="homePortalCardArrow" size={17} aria-hidden="true" />
        : <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />}
    </button>
  );
}
