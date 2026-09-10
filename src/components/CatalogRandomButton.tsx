"use client";

import { Dices } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { localeFromPathname, uiText, withLocalePath } from "@/lib/locale";
import { beginNavigationProgress } from "./NavigationProgress";

function randomCatalogHref(basePath: string, searchParams?: URLSearchParams) {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const seed = `${Date.now().toString(36)}-${randomPart}`;
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
