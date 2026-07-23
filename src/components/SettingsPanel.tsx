"use client";

import { ChevronDown, Dices, Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  COLOR_PALETTES,
  getColorPalette,
  isColorPalette,
  normalizeReaderTagsMode,
  PALETTE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_TAGS_STORAGE_KEY,
  TOP_MENU_STORAGE_KEY,
  type ColorPalette,
  type ReaderTagsMode,
} from "@/lib/ui-preferences";

type ThemeChoice = "system" | "light" | "dark";
type UiMode = "standard" | "minimal";

const themes: Array<{ value: ThemeChoice; label: string; icon: LucideIcon }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
];

const uiModes: Array<{ value: UiMode; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "minimal", label: "极简" },
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
    // Legacy cleanup is optional when storage is unavailable.
  }
}

function applyPalette(value: ColorPalette) {
  const palette = getColorPalette(value);
  const root = document.documentElement;
  root.dataset.palette = value;
  root.style.setProperty("--palette-light-accent", palette.lightAccent);
  root.style.setProperty("--palette-light-strong", palette.lightStrong);
  root.style.setProperty("--palette-dark-accent", palette.darkAccent);
  root.style.setProperty("--palette-dark-strong", palette.darkStrong);
}

function applySettings(
  theme: ThemeChoice,
  fontSize: number,
  uiMode: UiMode,
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

  root.dataset.uiMode = uiMode;
  root.dataset.readerTags = readerTagsMode;
  root.dataset.readerHotwords = showReaderHotwords ? "show" : "hide";
  root.style.setProperty("--reader-font-size", `${fontSize}px`);
  applyPalette(palette);
  if (persist) {
    writeLocalSetting("novel-theme", theme);
    writeLocalSetting("novel-font-size", String(fontSize));
    writeLocalSetting("novel-ui-mode", uiMode);
  }
}

export function SettingsPanel({
  previewText,
  defaultFontSize,
  defaultPalette,
  defaultTheme,
  defaultReaderTagsMode,
  canConfigureReaderTags,
  canConfigureReaderHotwords,
}: {
  previewText: string;
  defaultFontSize: number;
  defaultPalette: ColorPalette;
  defaultTheme: ThemeChoice;
  defaultReaderTagsMode: ReaderTagsMode;
  canConfigureReaderTags: boolean;
  canConfigureReaderHotwords: boolean;
}) {
  const [theme, setTheme] = useState<ThemeChoice>(defaultTheme);
  const [uiMode, setUiMode] = useState<UiMode>("standard");
  const [palette, setPalette] = useState<ColorPalette>(defaultPalette);
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [readerTagsMode, setReaderTagsMode] = useState<ReaderTagsMode>(defaultReaderTagsMode);
  const [showReaderHotwords, setShowReaderHotwords] = useState(true);
  const [showTopMenu, setShowTopMenu] = useState(true);
  const [hasHotwordPreference, setHasHotwordPreference] = useState(false);

  useEffect(() => {
    const savedTheme = readLocalSetting("novel-theme") as ThemeChoice | null;
    const savedUiMode = readLocalSetting("novel-ui-mode") as UiMode | null;
    const savedPalette = readLocalSetting(PALETTE_STORAGE_KEY);
    const savedFontSize = Number(readLocalSetting("novel-font-size"));
    const savedTags = readLocalSetting(READER_TAGS_STORAGE_KEY);
    const savedHotwords = readLocalSetting(READER_HOTWORDS_STORAGE_KEY);
    const savedTopMenu = readLocalSetting(TOP_MENU_STORAGE_KEY);
    const nextTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : defaultTheme;
    const nextUiMode = savedUiMode === "minimal" || savedUiMode === "standard" ? savedUiMode : "standard";
    const nextPalette = isColorPalette(savedPalette) ? savedPalette : defaultPalette;
    const nextFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 8 && savedFontSize <= 25 ? savedFontSize : defaultFontSize;
    const nextReaderTagsMode = normalizeReaderTagsMode(savedTags, defaultReaderTagsMode);
    const nextHasHotwordPreference = savedHotwords === "show" || savedHotwords === "hide";
    const nextShowHotwords = nextHasHotwordPreference ? savedHotwords === "show" : nextUiMode !== "minimal";

    setTheme(nextTheme);
    setUiMode(nextUiMode);
    setPalette(nextPalette);
    setFontSize(nextFontSize);
    setReaderTagsMode(nextReaderTagsMode);
    setShowReaderHotwords(nextShowHotwords);
    setShowTopMenu(savedTopMenu !== "hide");
    setHasHotwordPreference(nextHasHotwordPreference);
    removeLocalSetting("novel-palette");
    removeLocalSetting("novel-page-size");
    document.cookie = "novel-page-size=; Path=/; Max-Age=0; SameSite=Lax";
    applySettings(nextTheme, nextFontSize, nextUiMode, nextPalette, nextReaderTagsMode, nextShowHotwords, false);
    document.documentElement.dataset.topMenu = savedTopMenu === "hide" ? "hide" : "show";
  }, [defaultFontSize, defaultPalette, defaultReaderTagsMode, defaultTheme]);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    applySettings(value, fontSize, uiMode, palette, readerTagsMode, showReaderHotwords);
  }

  function changeUiMode(value: UiMode) {
    const nextShowHotwords = hasHotwordPreference ? showReaderHotwords : value !== "minimal";
    setUiMode(value);
    setShowReaderHotwords(nextShowHotwords);
    applySettings(theme, fontSize, value, palette, readerTagsMode, nextShowHotwords);
  }

  function changeFontSize(value: number) {
    setFontSize(value);
    applySettings(theme, value, uiMode, palette, readerTagsMode, showReaderHotwords);
  }

  function changePalette(value: ColorPalette) {
    setPalette(value);
    writeLocalSetting(PALETTE_STORAGE_KEY, value);
    applySettings(theme, fontSize, uiMode, value, readerTagsMode, showReaderHotwords);
  }

  function chooseRandomPalette() {
    const choices = COLOR_PALETTES.filter((item) => item.value !== palette);
    const next = choices[Math.floor(Math.random() * choices.length)];
    if (next) {
      changePalette(next.value);
    }
  }

  function changeReaderTags(mode: ReaderTagsMode) {
    setReaderTagsMode(mode);
    writeLocalSetting(READER_TAGS_STORAGE_KEY, mode);
    applySettings(theme, fontSize, uiMode, palette, mode, showReaderHotwords);
  }

  function changeReaderHotwords(visible: boolean) {
    setShowReaderHotwords(visible);
    setHasHotwordPreference(true);
    writeLocalSetting(READER_HOTWORDS_STORAGE_KEY, visible ? "show" : "hide");
    applySettings(theme, fontSize, uiMode, palette, readerTagsMode, visible);
  }

  function changeTopMenu(visible: boolean) {
    setShowTopMenu(visible);
    writeLocalSetting(TOP_MENU_STORAGE_KEY, visible ? "show" : "hide");
    document.documentElement.dataset.topMenu = visible ? "show" : "hide";
  }

  return (
    <section className="settingsPanel" aria-label="阅读设置">
      <div className="settingsGrid">
        <section className="settingBlock">
          <div className="settingBlockHeader">
            <h2>外观</h2>
          </div>
          <div className="settingRows">
            <div className="settingRow">
              <div className="settingRowTitle">
                <span>界面</span>
                <strong>{uiMode === "minimal" ? "极简" : "标准"}</strong>
              </div>
              <div className="segmentedControl" role="group" aria-label="界面模式">
                {uiModes.map((item) => (
                  <button className={uiMode === item.value ? "isActive" : ""} key={item.value} type="button" onClick={() => changeUiMode(item.value)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>明暗</span>
                <strong>{themes.find((item) => item.value === theme)?.label}</strong>
              </div>
              <div className="segmentedControl" role="group" aria-label="主题模式">
                {themes.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button className={theme === item.value ? "isActive" : ""} key={item.value} type="button" onClick={() => changeTheme(item.value)}>
                      <Icon size={17} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settingRow settingPaletteRow">
              <div className="settingRowTitle">
                <span>配色</span>
              </div>
              <div className="settingPalettePicker">
                <span className="paletteSwatches" aria-hidden="true">
                  <span style={{ backgroundColor: getColorPalette(palette).lightAccent }} />
                  <span style={{ backgroundColor: getColorPalette(palette).darkAccent }} />
                </span>
                <select aria-label="配色风格" value={palette} onChange={(event) => changePalette(event.target.value as ColorPalette)}>
                  {COLOR_PALETTES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                </select>
                <ChevronDown className="settingPaletteChevron" size={15} aria-hidden="true" />
                <button
                  className="settingPaletteRandomButton"
                  type="button"
                  onClick={chooseRandomPalette}
                  aria-label="随机选择配色"
                  title="随机选择配色"
                >
                  <Dices size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="settingBlock">
          <div className="settingBlockHeader">
            <h2>阅读</h2>
          </div>
          <div className="settingRows">
            <div className="settingRow">
              <div className="settingRowTitle">
                <span>字号</span>
                <strong>{fontSize} px</strong>
              </div>
              <div className="rangeRow">
                <span>8</span>
                <input aria-label="正文字号" type="range" min="8" max="25" step="1" value={fontSize} onChange={(event) => changeFontSize(Number(event.target.value))} />
                <span>25</span>
              </div>
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>布局</span>
              </div>
              <div className="settingMetaToggles">
                {canConfigureReaderTags ? (
                  <div className="settingReaderTagsMode">
                    <span>文章标签</span>
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
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {canConfigureReaderHotwords ? (
                  <label className="settingToggle">
                    <input type="checkbox" checked={showReaderHotwords} onChange={(event) => changeReaderHotwords(event.target.checked)} />
                    <span className="settingToggleTrack" aria-hidden="true" />
                    <span>文末热词</span>
                  </label>
                ) : null}
                <label className="settingToggle">
                  <input type="checkbox" checked={showTopMenu} onChange={(event) => changeTopMenu(event.target.checked)} />
                  <span className="settingToggleTrack" aria-hidden="true" />
                  <span>顶部导航</span>
                </label>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="previewReader" aria-label="阅读效果预览">
        <p>{previewText}</p>
      </div>
    </section>
  );
}
