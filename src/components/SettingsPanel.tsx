"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  TRADITIONAL_LOCALE,
  uiText,
  withLocalePath,
  type AppLocale,
} from "@/lib/locale";
import {
  DEFAULT_READER_LINE_HEIGHT,
  DEFAULT_READER_PAGE_TURN,
  getReaderThemeSystemTheme,
  isColorPalette,
  isReaderTheme,
  normalizeReaderJustify,
  normalizeReaderLineHeight,
  normalizeReaderPageTurn,
  normalizeReaderTagsMode,
  NOVEL_CATALOG_SEARCH_COOKIE,
  PALETTE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_JUSTIFY_STORAGE_KEY,
  READER_LINE_HEIGHT_STORAGE_KEY,
  READER_PAGE_TURN_OPTIONS,
  READER_PAGE_TURN_STORAGE_KEY,
  READER_PAPER_STORAGE_KEY,
  READER_TAGS_STORAGE_KEY,
  type ColorPalette,
  type ReaderLineHeight,
  type ReaderPageTurn,
  type ReaderTheme,
  type ReaderTagsMode,
} from "@/lib/ui-preferences";
import { clearReaderPaperPreference } from "@/lib/reader-theme-client";
import { applyColorPalette as applyPalette } from "@/lib/palette-client";
import { PalettePicker } from "./PalettePicker";
import { ReaderJustifyToggle, ReaderThemePicker } from "./ReaderDisplayPreferences";
import { ReaderFontSizeStepper, ReaderLineHeightStepper } from "./ReaderTypographyControls";

type ThemeChoice = "system" | "light" | "dark";

const themes: Array<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "暗色" },
];

function readLocalSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The visual setting still applies for the current page.
  }
}

function removeLocalSetting(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Clearing a preference is best effort; the visual state still applies.
  }
}


function applySettings(
  theme: ThemeChoice,
  fontSize: number,
  lineHeight: ReaderLineHeight,
  palette: ColorPalette,
  readerTagsMode: ReaderTagsMode,
  showReaderHotwords: boolean,
  persist = true,
) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = theme;
  }

  root.dataset.readerTags = readerTagsMode;
  root.dataset.readerHotwords = showReaderHotwords ? "show" : "hide";
  root.style.setProperty("--reader-font-size", `${fontSize}px`);
  root.style.setProperty("--reader-line-height", String(lineHeight));
  applyPalette(palette);
  if (persist) {
    writeLocalSetting("novel-theme", theme);
    writeLocalSetting("novel-font-size", String(fontSize));
    writeLocalSetting(READER_LINE_HEIGHT_STORAGE_KEY, String(lineHeight));
  }
}

export function SettingsPanel({
  defaultFontSize,
  defaultLineHeight = DEFAULT_READER_LINE_HEIGHT,
  defaultPalette,
  defaultTheme,
  defaultReaderTagsMode,
  defaultPageTurn = DEFAULT_READER_PAGE_TURN,
  canConfigureReaderTags,
  canConfigureReaderHotwords,
  currentLocale,
  novelCatalogSearchExpanded,
}: {
  defaultFontSize: number;
  defaultLineHeight?: ReaderLineHeight;
  defaultPalette: ColorPalette;
  defaultTheme: ThemeChoice;
  defaultReaderTagsMode: ReaderTagsMode;
  defaultPageTurn?: ReaderPageTurn;
  canConfigureReaderTags: boolean;
  canConfigureReaderHotwords: boolean;
  currentLocale: AppLocale;
  novelCatalogSearchExpanded: boolean;
}) {
  const [theme, setTheme] = useState<ThemeChoice>(defaultTheme);
  const [palette, setPalette] = useState<ColorPalette>(defaultPalette);
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [lineHeight, setLineHeight] = useState<ReaderLineHeight>(defaultLineHeight);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme | null>(null);
  const [justified, setJustified] = useState(true);
  const [pageTurn, setPageTurn] = useState<ReaderPageTurn>(defaultPageTurn);
  const [readerTagsMode, setReaderTagsMode] = useState<ReaderTagsMode>(defaultReaderTagsMode);
  const [showReaderHotwords, setShowReaderHotwords] = useState(true);
  const [catalogSearchExpanded, setCatalogSearchExpanded] = useState(novelCatalogSearchExpanded);

  const [locale, setLocale] = useState<AppLocale>(currentLocale);
  const [preferencePending, setPreferencePending] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const tr = (text: string) => uiText(locale, text);

  useEffect(() => {
    const savedTheme = readLocalSetting("novel-theme") as ThemeChoice | null;
    const savedPalette = readLocalSetting(PALETTE_STORAGE_KEY);
    const savedFontSize = Number(readLocalSetting("novel-font-size"));
    const nextLineHeight = normalizeReaderLineHeight(readLocalSetting(READER_LINE_HEIGHT_STORAGE_KEY), defaultLineHeight);
    const savedTags = readLocalSetting(READER_TAGS_STORAGE_KEY);
    const savedHotwords = readLocalSetting(READER_HOTWORDS_STORAGE_KEY);
    const savedReaderTheme = readLocalSetting(READER_PAPER_STORAGE_KEY);
    const nextReaderTheme = isReaderTheme(savedReaderTheme) ? savedReaderTheme : null;
    const savedJustified = normalizeReaderJustify(readLocalSetting(READER_JUSTIFY_STORAGE_KEY));
    const savedPageTurn = readLocalSetting(READER_PAGE_TURN_STORAGE_KEY);
    const nextPageTurn = normalizeReaderPageTurn(savedPageTurn, defaultPageTurn);
    const storedTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : defaultTheme;
    const nextTheme = nextReaderTheme ? getReaderThemeSystemTheme(nextReaderTheme) : storedTheme;
    const nextPalette = isColorPalette(savedPalette) ? savedPalette : defaultPalette;
    const nextFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 8 && savedFontSize <= 25 ? savedFontSize : defaultFontSize;
    const nextReaderTagsMode = normalizeReaderTagsMode(savedTags, defaultReaderTagsMode);
    const nextHasHotwordPreference = savedHotwords === "show" || savedHotwords === "hide";
    const nextShowHotwords = nextHasHotwordPreference ? savedHotwords === "show" : true;

    setTheme(nextTheme);
    setPalette(nextPalette);
    setFontSize(nextFontSize);
    setLineHeight(nextLineHeight);
    setReaderTheme(nextReaderTheme);
    setJustified(savedJustified);
    setPageTurn(nextPageTurn);
    setReaderTagsMode(nextReaderTagsMode);
    setShowReaderHotwords(nextShowHotwords);
    setCatalogSearchExpanded(novelCatalogSearchExpanded);

    document.documentElement.removeAttribute("data-ui-mode");
    document.documentElement.removeAttribute("data-top-menu");
    if (nextReaderTheme) document.documentElement.dataset.readerTheme = nextReaderTheme;
    else document.documentElement.removeAttribute("data-reader-theme");
    document.documentElement.dataset.readerJustify = savedJustified ? "on" : "off";
    document.documentElement.dataset.readerPageTurn = nextPageTurn;
    applySettings(nextTheme, nextFontSize, nextLineHeight, nextPalette, nextReaderTagsMode, nextShowHotwords, false);
  }, [defaultFontSize, defaultLineHeight, defaultPageTurn, defaultPalette, defaultReaderTagsMode, defaultTheme, novelCatalogSearchExpanded]);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    setReaderTheme(null);
    clearReaderPaperPreference();
    if (value === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = value;
    }
    writeLocalSetting("novel-theme", value);
  }

  function changeFontSize(value: number) {
    const nextValue = Math.min(Math.max(value, 8), 25);
    setFontSize(nextValue);
    document.documentElement.style.setProperty("--reader-font-size", `${nextValue}px`);
    writeLocalSetting("novel-font-size", String(nextValue));
  }

  function changeLineHeight(value: ReaderLineHeight) {
    setLineHeight(value);
    document.documentElement.style.setProperty("--reader-line-height", String(value));
    writeLocalSetting(READER_LINE_HEIGHT_STORAGE_KEY, String(value));
  }

  function changeReaderTheme(value: ReaderTheme) {
    const selectedTheme = readerTheme === value ? null : value;
    const root = document.documentElement;
    setReaderTheme(selectedTheme);
    if (!selectedTheme) {
      root.removeAttribute("data-reader-theme");
      removeLocalSetting(READER_PAPER_STORAGE_KEY);
      return;
    }
    const nextTheme = getReaderThemeSystemTheme(selectedTheme);
    setTheme(nextTheme);
    root.dataset.theme = nextTheme;
    root.dataset.readerTheme = selectedTheme;
    writeLocalSetting("novel-theme", nextTheme);
    writeLocalSetting(READER_PAPER_STORAGE_KEY, selectedTheme);
  }

  function changeJustified(value: boolean) {
    setJustified(value);
    const storedValue = value ? "on" : "off";
    document.documentElement.dataset.readerJustify = storedValue;
    writeLocalSetting(READER_JUSTIFY_STORAGE_KEY, storedValue);
  }

  function changePageTurn(value: ReaderPageTurn) {
    setPageTurn(value);
    document.documentElement.dataset.readerPageTurn = value;
    writeLocalSetting(READER_PAGE_TURN_STORAGE_KEY, value);
  }

  function changePalette(value: ColorPalette) {
    setPalette(value);
    applyPalette(value);
    writeLocalSetting(PALETTE_STORAGE_KEY, value);
  }

  function changeReaderTags(mode: ReaderTagsMode) {
    setReaderTagsMode(mode);
    document.documentElement.dataset.readerTags = mode;
    writeLocalSetting(READER_TAGS_STORAGE_KEY, mode);
  }

  function changeReaderHotwords(visible: boolean) {
    setShowReaderHotwords(visible);

    document.documentElement.dataset.readerHotwords = visible ? "show" : "hide";
    writeLocalSetting(READER_HOTWORDS_STORAGE_KEY, visible ? "show" : "hide");
  }

  function changeCatalogSearchExpanded(expanded: boolean) {
    setCatalogSearchExpanded(expanded);
    document.cookie = `${NOVEL_CATALOG_SEARCH_COOKIE}=${expanded ? "expanded" : "collapsed"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  async function changeLanguage(nextLocale: AppLocale) {
    if (nextLocale === locale || preferencePending) return;
    setPreferencePending(true);
    setPreferenceMessage("");
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error("locale update failed");
      document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
      setLocale(nextLocale);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(withLocalePath(current, nextLocale));
    } catch {
      setPreferenceMessage("语言设置保存失败");
      setPreferencePending(false);
    }
  }

  return (
    <section className="settingsPanel" aria-label={tr("设置")}>
      <div className="settingsGrid">
        <section className="settingBlock">
          <div className="settingBlockHeader">
            <h2>{tr("外观")}</h2>
          </div>
          <div className="settingRows">
            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("语言")}</span>
              </div>
              <div className="segmentedControl settingCompactSegments" role="group" aria-label={tr("语言")}>
                <button
                  className={locale === DEFAULT_LOCALE ? "isActive" : ""}
                  type="button"
                  disabled={preferencePending}
                  onClick={() => void changeLanguage(DEFAULT_LOCALE)}
                >
                  {tr("简体")}
                </button>
                <button
                  className={locale === TRADITIONAL_LOCALE ? "isActive" : ""}
                  type="button"
                  disabled={preferencePending}
                  onClick={() => void changeLanguage(TRADITIONAL_LOCALE)}
                >
                  繁體
                </button>
              </div>
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("明暗")}</span>
              </div>
              <div className="segmentedControl settingCompactSegments" role="group" aria-label="主题模式">
                {themes.map((item) => (
                  <button className={theme === item.value ? "isActive" : ""} key={item.value} type="button" onClick={() => changeTheme(item.value)}>
                    {tr(item.label)}
                  </button>
                ))}
              </div>
            </div>

            <div className="settingRow settingPaletteRow">
              <div className="settingRowTitle">
                <span>{tr("配色")}</span>
              </div>
              <PalettePicker className="settingPalettePicker" value={palette} onChange={changePalette} />
            </div>
          </div>
        </section>

        <section className="settingBlock">
          <div className="settingBlockHeader">
            <h2>{tr("阅读")}</h2>
          </div>
          <div className="settingRows">
            <div className="settingRow settingReaderThemeRow">
              <div className="settingRowTitle">
                <span>{tr("主题")}</span>
              </div>
              <ReaderThemePicker
                className="settingsReaderThemePicker"
                value={readerTheme}
                onChange={changeReaderTheme}
                labelFor={tr}
              />
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("字号")}</span>
              </div>
              <ReaderFontSizeStepper value={fontSize} onChange={changeFontSize} />
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("行距")}</span>
              </div>
              <ReaderLineHeightStepper value={lineHeight} onChange={changeLineHeight} />
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("两端对齐")}</span>
              </div>
              <ReaderJustifyToggle
                checked={justified}
                onChange={changeJustified}
                label={tr("两端对齐")}
                className="settingsReaderJustifyToggle"
              />
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("翻页方式")}</span>
              </div>
              <div className="segmentedControl settingCompactSegments" role="group" aria-label={tr("翻页方式")}>
                {READER_PAGE_TURN_OPTIONS.map((item) => (
                  <button
                    className={pageTurn === item.value ? "isActive" : ""}
                    key={item.value}
                    type="button"
                    onClick={() => changePageTurn(item.value)}
                    aria-pressed={pageTurn === item.value}
                  >
                    {tr(item.label)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="settingBlock">
          <div className="settingBlockHeader">
            <h2>{tr("布局")}</h2>
          </div>
          <div className="settingRows">
            <div className="settingRow">
              <div className="settingRowTitle">
                <span>{tr("小说搜索")}</span>
              </div>
              <div className="segmentedControl settingCompactSegments" role="group" aria-label={tr("小说搜索框默认状态")}>
                {([true, false] as const).map((expanded) => (
                  <button
                    className={catalogSearchExpanded === expanded ? "isActive" : ""}
                    type="button"
                    aria-pressed={catalogSearchExpanded === expanded}
                    key={String(expanded)}
                    onClick={() => changeCatalogSearchExpanded(expanded)}
                  >
                    {tr(expanded ? "展开" : "收起")}
                  </button>
                ))}
              </div>
            </div>
            {canConfigureReaderTags ? (
              <div className="settingRow">
                <div className="settingRowTitle"><span>{tr("文章标签")}</span></div>
                <div className="segmentedControl settingCompactSegments" role="group" aria-label="文章标签显示方式">
                  {([
                    ["expanded", "展开"],
                    ["collapsed", "收起"],
                    ["hidden", "关闭"],
                  ] as const).map(([value, label]) => (
                    <button
                      className={readerTagsMode === value ? "isActive" : ""}
                      type="button"
                      aria-pressed={readerTagsMode === value}
                      key={value}
                      onClick={() => changeReaderTags(value)}
                    >
                      {tr(label)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {canConfigureReaderHotwords ? (
              <div className="settingRow">
                <div className="settingRowTitle"><span>{tr("文末热词")}</span></div>
                <div className="segmentedControl settingCompactSegments" role="group" aria-label={tr("文末热词")}>
                  {([
                    [true, "显示"],
                    [false, "关闭"],
                  ] as const).map(([visible, label]) => (
                    <button
                      className={showReaderHotwords === visible ? "isActive" : ""}
                      type="button"
                      aria-pressed={showReaderHotwords === visible}
                      key={String(visible)}
                      onClick={() => changeReaderHotwords(visible)}
                    >
                      {tr(label)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {preferenceMessage ? (
        <p className="settingsPreferenceNotice" role="status">{preferenceMessage}</p>
      ) : null}

    </section>
  );
}
