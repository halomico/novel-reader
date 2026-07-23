import {
  COLOR_PALETTES,
  ADMIN_SIDEBAR_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_TAGS_STORAGE_KEY,
  TOP_MENU_STORAGE_KEY,
  type ColorPalette,
  type ReaderTagsMode,
} from "@/lib/ui-preferences";

export function ThemeScript({
  defaultTheme = "system",
  defaultFontSize = 18,
  defaultPalette = "default",
  defaultReaderTagsMode = "collapsed",
}: {
  defaultTheme?: "system" | "light" | "dark";
  defaultFontSize?: number;
  defaultPalette?: ColorPalette;
  defaultReaderTagsMode?: ReaderTagsMode;
}) {
  const paletteTokens = Object.fromEntries(COLOR_PALETTES.map((palette) => [palette.value, palette]));
  const code = `
    (function () {
      try {
        var root = document.documentElement;
        var theme = localStorage.getItem("novel-theme") || ${JSON.stringify(defaultTheme)};
        var uiMode = localStorage.getItem("novel-ui-mode") || "standard";
        var paletteName = localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)}) || ${JSON.stringify(defaultPalette)};
        var palettes = ${JSON.stringify(paletteTokens)};
        var palette = palettes[paletteName] || palettes[${JSON.stringify(defaultPalette)}];
        var readerTags = localStorage.getItem(${JSON.stringify(READER_TAGS_STORAGE_KEY)});
        var readerHotwords = localStorage.getItem(${JSON.stringify(READER_HOTWORDS_STORAGE_KEY)});
        var topMenu = localStorage.getItem(${JSON.stringify(TOP_MENU_STORAGE_KEY)});
        var adminSidebarCollapsed = localStorage.getItem(${JSON.stringify(ADMIN_SIDEBAR_STORAGE_KEY)}) === "true";
        var fontSize = Number(localStorage.getItem("novel-font-size") || ${JSON.stringify(defaultFontSize)});
        if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 25) {
          fontSize = ${JSON.stringify(defaultFontSize)};
        }
        if (theme === "light" || theme === "dark") {
          root.dataset.theme = theme;
        } else {
          root.removeAttribute("data-theme");
        }
        uiMode = uiMode === "minimal" ? "minimal" : "standard";
        root.dataset.uiMode = uiMode;
        root.dataset.palette = palette.value;
        root.dataset.readerTags = readerTags === "collapsed"
          ? "collapsed"
          : (readerTags === "hidden" || readerTags === "hide"
            ? "hidden"
            : (readerTags === "expanded" || readerTags === "show"
              ? "expanded"
              : ${JSON.stringify(defaultReaderTagsMode)}));
        root.dataset.readerHotwords = readerHotwords === "show" || readerHotwords === "hide" ? readerHotwords : (uiMode === "minimal" ? "hide" : "show");
        root.dataset.topMenu = topMenu === "hide" ? "hide" : "show";
        root.dataset.adminSidebar = adminSidebarCollapsed ? "collapsed" : "expanded";
        root.style.setProperty("--reader-font-size", fontSize + "px");
        root.style.setProperty("--palette-light-accent", palette.lightAccent);
        root.style.setProperty("--palette-light-strong", palette.lightStrong);
        root.style.setProperty("--palette-dark-accent", palette.darkAccent);
        root.style.setProperty("--palette-dark-strong", palette.darkStrong);
        localStorage.removeItem("novel-palette");
      } catch (error) {}
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
