"use client";

import { ChevronRight, Dices } from "lucide-react";
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

export function CatalogRandomCard() {
  const router = useRouter();

  function openRandomSelection() {
    beginNavigationProgress();
    router.push(randomCatalogHref());
  }

  return (
    <button className="homePortalCard is-random" type="button" onClick={openRandomSelection}>
      <span className="homePortalCardIcon" aria-hidden="true">
        <Dices size={30} />
      </span>
      <strong>随便看看</strong>
      <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />
    </button>
  );
}
