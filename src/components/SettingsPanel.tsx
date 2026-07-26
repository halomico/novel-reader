"use client";

import { ChevronDown, Dices, Minus, Monitor, Moon, Plus, Sun } from "lucide-react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  COLOR_PALETTES,
  DEFAULT_READER_LINE_HEIGHT,
  getColorPalette,
  isColorPalette,
  normalizeReaderLineHeight,
  normalizeReaderTagsMode,
  PALETTE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_LINE_HEIGHT_STORAGE_KEY,
  READER_LINE_HEIGHTS,
  READER_TAGS_STORAGE_KEY,
  TOP_MENU_STORAGE_KEY,
  type ColorPalette,
  type ReaderLineHeight,
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
  lineHeight: ReaderLineHeight,
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
  root.style.setProperty("--reader-line-height", String(lineHeight));
  applyPalette(palette);
  if (persist) {
    writeLocalSetting("novel-theme", theme);
    writeLocalSetting("novel-font-size", String(fontSize));
    writeLocalSetting(READER_LINE_HEIGHT_STORAGE_KEY, String(lineHeight));
    writeLocalSetting("novel-ui-mode", uiMode);
  }
}

export function SettingsPanel({
  previewText,
  defaultFontSize,
  defaultLineHeight = DEFAULT_READER_LINE_HEIGHT,
  defaultPalette,
  defaultTheme,
  defaultReaderTagsMode,
  canConfigureReaderTags,
  canConfigureReaderHotwords,
}: {
  previewText: string;
  defaultFontSize: number;
  defaultLineHeight?: ReaderLineHeight;
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
  const [lineHeight, setLineHeight] = useState<ReaderLineHeight>(defaultLineHeight);
  const [readerTagsMode, setReaderTagsMode] = useState<ReaderTagsMode>(defaultReaderTagsMode);
  const [showReaderHotwords, setShowReaderHotwords] = useState(true);
  const [showTopMenu, setShowTopMenu] = useState(true);
  const [hasHotwordPreference, setHasHotwordPreference] = useState(false);

  useEffect(() => {
    const savedTheme = readLocalSetting("novel-theme") as ThemeChoice | null;
    const savedUiMode = readLocalSetting("novel-ui-mode") as UiMode | null;
    const savedPalette = readLocalSetting(PALETTE_STORAGE_KEY);
    const savedFontSize = Number(readLocalSetting("novel-font-size"));
    const nextLineHeight = normalizeReaderLineHeight(readLocalSetting(READER_LINE_HEIGHT_STORAGE_KEY), defaultLineHeight);
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
    setLineHeight(nextLineHeight);
    setReaderTagsMode(nextReaderTagsMode);
    setShowReaderHotwords(nextShowHotwords);
    setShowTopMenu(savedTopMenu !== "hide");
    setHasHotwordPreference(nextHasHotwordPreference);
    removeLocalSetting("novel-palette");
    removeLocalSetting("novel-page-size");
    document.cookie = "novel-page-size=; Path=/; Max-Age=0; SameSite=Lax";
    applySettings(nextTheme, nextFontSize, nextLineHeight, nextUiMode, nextPalette, nextReaderTagsMode, nextShowHotwords, false);
    document.documentElement.dataset.topMenu = savedTopMenu === "hide" ? "hide" : "show";
  }, [defaultFontSize, defaultLineHeight, defaultPalette, defaultReaderTagsMode, defaultTheme]);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    if (value === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = value;
    }
    writeLocalSetting("novel-theme", value);
  }

  function changeUiMode(value: UiMode) {
    const nextShowHotwords = hasHotwordPreference ? showReaderHotwords : value !== "minimal";
    setUiMode(value);
    setShowReaderHotwords(nextShowHotwords);
    document.documentElement.dataset.uiMode = value;
    document.documentElement.dataset.readerHotwords = nextShowHotwords ? "show" : "hide";
    writeLocalSetting("novel-ui-mode", value);
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

  function changePalette(value: ColorPalette) {
    setPalette(value);
    applyPalette(value);
    writeLocalSetting(PALETTE_STORAGE_KEY, value);
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
    document.documentElement.dataset.readerTags = mode;
    writeLocalSetting(READER_TAGS_STORAGE_KEY, mode);
  }

  function changeReaderHotwords(visible: boolean) {
    setShowReaderHotwords(visible);
    setHasHotwordPreference(true);
    document.documentElement.dataset.readerHotwords = visible ? "show" : "hide";
    writeLocalSetting(READER_HOTWORDS_STORAGE_KEY, visible ? "show" : "hide");
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
              </div>
              <div className="fontSizeStepper" role="group" aria-label="正文字号">
                <button type="button" onClick={() => changeFontSize(fontSize - 1)} disabled={fontSize <= 8} aria-label="减小字号" title="减小字号">
                  <Minus size={17} aria-hidden="true" />
                </button>
                <output aria-live="polite">{fontSize}</output>
                <button type="button" onClick={() => changeFontSize(fontSize + 1)} disabled={fontSize >= 25} aria-label="增大字号" title="增大字号">
                  <Plus size={17} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="settingRow">
              <div className="settingRowTitle">
                <span>行距</span>
              </div>
              <div
                className="readerLineHeightControl"
                style={{ "--reader-line-height-progress": `${(READER_LINE_HEIGHTS.indexOf(lineHeight) / (READER_LINE_HEIGHTS.length - 1)) * 100}%` } as CSSProperties}
              >
                <div className="readerLineHeightSlider">
                  <span className="readerLineHeightTrack" aria-hidden="true" />
                  <input
                    aria-label="正文行距"
                    aria-valuetext={`${lineHeight.toFixed(1)} 倍`}
                    type="range"
                    min="1"
                    max={READER_LINE_HEIGHTS.length}
                    step="1"
                    value={READER_LINE_HEIGHTS.indexOf(lineHeight) + 1}
                    onChange={(event) => changeLineHeight(READER_LINE_HEIGHTS[Number(event.target.value) - 1] || DEFAULT_READER_LINE_HEIGHT)}
                  />
                  <span className="readerLineHeightTicks" aria-hidden="true">
                    {READER_LINE_HEIGHTS.map((value) => <i key={value} />)}
                  </span>
                </div>
                <output aria-live="polite">{lineHeight.toFixed(1)}</output>
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
                    <span>文末热词</span>
                    <span className="settingToggleTrack" aria-hidden="true"><span /></span>
                  </label>
                ) : null}
                <label className="settingToggle">
                  <input type="checkbox" checked={showTopMenu} onChange={(event) => changeTopMenu(event.target.checked)} />
                  <span>顶部导航</span>
                  <span className="settingToggleTrack" aria-hidden="true"><span /></span>
                </label>
              </div>
            </div>
          </div>
        </section>
      </div>

      {previewText ? (
        <div className="previewReader" aria-label="阅读效果预览">
          <p>{previewText}</p>
        </div>
      ) : null}
    </section>
  );
}
