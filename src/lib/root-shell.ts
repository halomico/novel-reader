import { unstable_cache } from "next/cache";
import { defaultSiteSettings, readPostgresSiteSettings } from "@/core/config/site-settings";
import { getSiteIconHref } from "./site-icon";
import { getSiteUrl, getUmamiConfig } from "./seo";
import { resolveDefaultPalette } from "./ui-preferences";

export const ROOT_SHELL_CACHE_TAG = "root-shell-configuration";

export const getRootShellConfiguration = unstable_cache(
  async () => {
    // Compilation has no runtime database by design. NEXT_PHASE covers every
    // Next.js production build; DOCKER_BUILD is an explicit Docker safeguard.
    // Neither value is present in the shipped runner, so requests still fail
    // closed when PostgreSQL was not initialized.
    const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build"
      || process.env.DOCKER_BUILD === "1";
    const settings = isProductionBuild
      ? defaultSiteSettings()
      : await readPostgresSiteSettings();
    const siteName = settings.siteName || process.env.SITE_NAME || "Example Reader";
    const siteTitle = settings.siteTitle || process.env.SITE_TITLE || siteName;
    return {
      siteTitle,
      siteUrl: getSiteUrl(),
      description: "简洁、快速的中文小说在线阅读站。",
      iconHref: getSiteIconHref(settings),
      umami: getUmamiConfig(),
      theme: settings.adminTheme,
      readerDefaultFontSize: settings.readerDefaultFontSize,
      readerDefaultLineHeight: settings.readerDefaultLineHeight,
      readerDefaultTagsMode: settings.readerDefaultTagsMode,
      readerDefaultPageTurn: settings.readerDefaultPageTurn,
      defaultPalette: settings.defaultPalette,
      defaultPaletteRandomEnabled: settings.defaultPaletteRandomEnabled,
      defaultPaletteRotationMinutes: settings.defaultPaletteRotationMinutes,
      resolvedDefaultPalette: resolveDefaultPalette(
        settings.defaultPalette,
        settings.defaultPaletteRandomEnabled,
        settings.defaultPaletteRotationMinutes,
      ),
    };
  },
  ["root-shell-configuration-v1"],
  { tags: [ROOT_SHELL_CACHE_TAG] },
);
