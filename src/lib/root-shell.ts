import { unstable_cache } from "next/cache";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { getSiteIconHref } from "./site-icon";
import { getSiteUrl, getUmamiConfig } from "./seo";
import { resolveDefaultPalette } from "./ui-preferences";

export const ROOT_SHELL_CACHE_TAG = "root-shell-configuration";

export const getRootShellConfiguration = unstable_cache(
  async () => {
    const settings = await readPostgresSiteSettings();
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
