import {
  COLOR_PALETTES,
  ADMIN_SIDEBAR_STORAGE_KEY,
  DEFAULT_READER_WIDTH,
  PALETTE_STORAGE_KEY,
  READER_FONT_SIZE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_LINE_HEIGHT_STORAGE_KEY,
  READER_LINE_HEIGHTS,
  READER_JUSTIFY_STORAGE_KEY,
  READER_PAGE_TURN_OPTIONS,
  READER_PAGE_TURN_STORAGE_KEY,
  READER_PAPER_STORAGE_KEY,
  READER_THEME_OPTIONS,
  READER_WIDTH_STORAGE_KEY,
  READER_WIDTHS,
  LEGACY_READER_THEME_STORAGE_KEYS,
  READER_TAGS_STORAGE_KEY,
  DEFAULT_READER_LINE_HEIGHT,
  getReaderThemeSystemTheme,
  type ColorPalette,
  type ReaderLineHeight,
  type ReaderTagsMode,
} from "@/lib/ui-preferences";
import { READER_KEEP_CHROME_SESSION_KEY } from "@/lib/reader-layout";

export function ThemeScript({
  defaultTheme = "system",
  defaultFontSize = 18,
  defaultLineHeight = DEFAULT_READER_LINE_HEIGHT,
  defaultPalette = "default",
  defaultReaderTagsMode = "collapsed",
}: {
  defaultTheme?: "system" | "light" | "dark";
  defaultFontSize?: number;
  defaultLineHeight?: ReaderLineHeight;
  defaultPalette?: ColorPalette;
  defaultReaderTagsMode?: ReaderTagsMode;
}) {
  const paletteTokens = Object.fromEntries(COLOR_PALETTES.map((palette) => [palette.value, palette]));
  const readerThemeSystemThemes = Object.fromEntries(
    READER_THEME_OPTIONS.map((theme) => [theme.value, getReaderThemeSystemTheme(theme.value)]),
  );
  const code = `
    (function () {
      try {
        var root = document.documentElement;
        var readerRoute = /(?:^|\\/)books\\/\\d+(?:\\/|$)/.test(window.location.pathname) ||
          /(?:^|\\/)original\\/(?!new(?:\\/|$)|mine(?:\\/|$)|tags(?:\\/|$)|author(?:\\/|$))[^/]+\\/?$/.test(window.location.pathname);
        var keepReaderChrome = sessionStorage.getItem(${JSON.stringify(READER_KEEP_CHROME_SESSION_KEY)}) === "1";
        if (readerRoute && window.matchMedia("(max-width: 820px)").matches && !keepReaderChrome) {
          root.classList.add("isReaderChromeHidden");
        }
        var theme = localStorage.getItem("novel-theme") || ${JSON.stringify(defaultTheme)};
        var paletteName = localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)}) || ${JSON.stringify(defaultPalette)};
        var palettes = ${JSON.stringify(paletteTokens)};
        var palette = palettes[paletteName] || palettes[${JSON.stringify(defaultPalette)}];
        var readerTags = localStorage.getItem(${JSON.stringify(READER_TAGS_STORAGE_KEY)});
        var readerHotwords = localStorage.getItem(${JSON.stringify(READER_HOTWORDS_STORAGE_KEY)});
        var readerLineHeights = ${JSON.stringify(READER_LINE_HEIGHTS)};
        var readerLineHeight = Number(localStorage.getItem(${JSON.stringify(READER_LINE_HEIGHT_STORAGE_KEY)}) || ${defaultLineHeight});
        var readerPageTurnOptions = ${JSON.stringify(READER_PAGE_TURN_OPTIONS.map((option) => option.value))};
        var readerPageTurn = localStorage.getItem(${JSON.stringify(READER_PAGE_TURN_STORAGE_KEY)});
        var readerJustify = localStorage.getItem(${JSON.stringify(READER_JUSTIFY_STORAGE_KEY)});
        var readerWidthOptions = ${JSON.stringify(READER_WIDTHS.filter((value) => value !== "auto"))};
        var readerWidthValue = localStorage.getItem(${JSON.stringify(READER_WIDTH_STORAGE_KEY)});
        var readerWidth = readerWidthValue === "auto" ? "auto" : Number(readerWidthValue || ${DEFAULT_READER_WIDTH});
        var readerPaper = localStorage.getItem(${JSON.stringify(READER_PAPER_STORAGE_KEY)});
        var readerThemeSystemThemes = ${JSON.stringify(readerThemeSystemThemes)};
        var adminSidebarCollapsed = localStorage.getItem(${JSON.stringify(ADMIN_SIDEBAR_STORAGE_KEY)}) === "true";
        var fontSize = Number(localStorage.getItem(${JSON.stringify(READER_FONT_SIZE_STORAGE_KEY)}) || ${JSON.stringify(defaultFontSize)});
        if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 25) {
          fontSize = ${JSON.stringify(defaultFontSize)};
        }
        if (readerLineHeights.indexOf(readerLineHeight) === -1) {
          readerLineHeight = Number.isFinite(readerLineHeight) && readerLineHeight >= 0.8 && readerLineHeight <= 2.5
            ? readerLineHeights.reduce(function(nearest, item) {
                return Math.abs(item - readerLineHeight) < Math.abs(nearest - readerLineHeight) ? item : nearest;
              })
            : ${defaultLineHeight};
        }
        if (readerPageTurnOptions.indexOf(readerPageTurn) === -1) {
          readerPageTurn = "scroll";
        }
        if (readerWidth !== "auto" && readerWidthOptions.indexOf(readerWidth) === -1) {
          readerWidth = ${DEFAULT_READER_WIDTH};
        }
        var validReaderPaper = Object.prototype.hasOwnProperty.call(readerThemeSystemThemes, readerPaper);
        if (validReaderPaper) {
          theme = readerThemeSystemThemes[readerPaper];
          localStorage.setItem("novel-theme", theme);
          root.dataset.readerTheme = readerPaper;
        } else {
          root.removeAttribute("data-reader-theme");
        }
        if (theme === "light" || theme === "dark") {
          root.dataset.theme = theme;
        } else {
          root.removeAttribute("data-theme");
        }
        root.dataset.palette = palette.value;
        root.dataset.readerTags = readerTags === "collapsed"
          ? "collapsed"
          : (readerTags === "hidden" || readerTags === "hide"
            ? "hidden"
            : (readerTags === "expanded" || readerTags === "show"
              ? "expanded"
              : ${JSON.stringify(defaultReaderTagsMode)}));
        root.dataset.readerHotwords = readerHotwords === "show" || readerHotwords === "hide" ? readerHotwords : "show";
        root.dataset.readerPageTurn = readerPageTurn;
        root.dataset.readerJustify = readerJustify === "off" ? "off" : "on";
        root.dataset.readerWidth = String(readerWidth);
        root.dataset.adminSidebar = adminSidebarCollapsed ? "collapsed" : "expanded";
        root.style.setProperty("--reader-font-size", fontSize + "px");
        root.style.setProperty("--reader-line-height", String(readerLineHeight));
        if (readerWidth === "auto") {
          root.style.removeProperty("--reader-preferred-paper-width");
        } else {
          root.style.setProperty("--reader-preferred-paper-width", readerWidth + "px");
        }
        root.style.setProperty("--palette-light-accent", palette.lightAccent);
        root.style.setProperty("--palette-light-strong", palette.lightStrong);
        root.style.setProperty("--palette-dark-accent", palette.darkAccent);
        root.style.setProperty("--palette-dark-strong", palette.darkStrong);
        localStorage.removeItem("novel-palette");
        localStorage.removeItem("novel-ui-mode");
        localStorage.removeItem("novel-reader-top-menu");
        ${JSON.stringify(LEGACY_READER_THEME_STORAGE_KEYS)}.forEach(function(key) { localStorage.removeItem(key); });
        root.removeAttribute("data-ui-mode");
        root.removeAttribute("data-top-menu");
      } catch (error) {}
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
