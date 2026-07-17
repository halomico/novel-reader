"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  COLOR_PALETTES,
  getColorPalette,
  isColorPalette,
  PALETTE_STORAGE_KEY,
  READER_HOTWORDS_STORAGE_KEY,
  READER_TAGS_STORAGE_KEY,
  type ColorPalette,
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
  root.style.setProperty("--palette-light-tint", palette.lightTint);
  root.style.setProperty("--palette-dark-accent", palette.darkAccent);
  root.style.setProperty("--palette-dark-strong", palette.darkStrong);
  root.style.setProperty("--palette-dark-tint", palette.darkTint);
}

function applySettings(
  theme: ThemeChoice,
  fontSize: number,
  uiMode: UiMode,
  palette: ColorPalette,
  showReaderTags: boolean,
  showReaderHotwords: boolean,
) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = theme;
  }

  root.dataset.uiMode = uiMode;
  root.dataset.readerTags = showReaderTags ? "show" : "hide";
  root.dataset.readerHotwords = showReaderHotwords ? "show" : "hide";
  root.style.setProperty("--reader-font-size", `${fontSize}px`);
  applyPalette(palette);
  writeLocalSetting("novel-theme", theme);
  writeLocalSetting("novel-font-size", String(fontSize));
  writeLocalSetting("novel-ui-mode", uiMode);
}

export function SettingsPanel({
  previewText,
  defaultFontSize,
  defaultPalette,
  canConfigureContentMeta,
}: {
  previewText: string;
  defaultFontSize: number;
  defaultPalette: ColorPalette;
  canConfigureContentMeta: boolean;
}) {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [uiMode, setUiMode] = useState<UiMode>("standard");
  const [palette, setPalette] = useState<ColorPalette>(defaultPalette);
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [showReaderTags, setShowReaderTags] = useState(true);
  const [showReaderHotwords, setShowReaderHotwords] = useState(true);
  const [hasHotwordPreference, setHasHotwordPreference] = useState(false);

  useEffect(() => {
    const savedTheme = readLocalSetting("novel-theme") as ThemeChoice | null;
    const savedUiMode = readLocalSetting("novel-ui-mode") as UiMode | null;
    const savedPalette = readLocalSetting(PALETTE_STORAGE_KEY);
    const savedFontSize = Number(readLocalSetting("novel-font-size"));
    const savedTags = readLocalSetting(READER_TAGS_STORAGE_KEY);
    const savedHotwords = readLocalSetting(READER_HOTWORDS_STORAGE_KEY);
    const nextTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
    const nextUiMode = savedUiMode === "minimal" || savedUiMode === "standard" ? savedUiMode : "standard";
    const nextPalette = isColorPalette(savedPalette) ? savedPalette : defaultPalette;
    const nextFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 8 && savedFontSize <= 25 ? savedFontSize : defaultFontSize;
    const nextShowTags = savedTags !== "hide";
    const nextHasHotwordPreference = savedHotwords === "show" || savedHotwords === "hide";
    const nextShowHotwords = nextHasHotwordPreference ? savedHotwords === "show" : nextUiMode !== "minimal";

    setTheme(nextTheme);
    setUiMode(nextUiMode);
    setPalette(nextPalette);
    setFontSize(nextFontSize);
    setShowReaderTags(nextShowTags);
    setShowReaderHotwords(nextShowHotwords);
    setHasHotwordPreference(nextHasHotwordPreference);
    removeLocalSetting("novel-palette");
    removeLocalSetting("novel-page-size");
    document.cookie = "novel-page-size=; Path=/; Max-Age=0; SameSite=Lax";
    applySettings(nextTheme, nextFontSize, nextUiMode, nextPalette, nextShowTags, nextShowHotwords);
  }, [defaultFontSize, defaultPalette]);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    applySettings(value, fontSize, uiMode, palette, showReaderTags, showReaderHotwords);
  }

  function changeUiMode(value: UiMode) {
    const nextShowHotwords = hasHotwordPreference ? showReaderHotwords : value !== "minimal";
    setUiMode(value);
    setShowReaderHotwords(nextShowHotwords);
    applySettings(theme, fontSize, value, palette, showReaderTags, nextShowHotwords);
  }

  function changeFontSize(value: number) {
    setFontSize(value);
    applySettings(theme, value, uiMode, palette, showReaderTags, showReaderHotwords);
  }

  function changePalette(value: ColorPalette) {
    setPalette(value);
    writeLocalSetting(PALETTE_STORAGE_KEY, value);
    applySettings(theme, fontSize, uiMode, value, showReaderTags, showReaderHotwords);
  }

  function changeReaderTags(visible: boolean) {
    setShowReaderTags(visible);
    writeLocalSetting(READER_TAGS_STORAGE_KEY, visible ? "show" : "hide");
    applySettings(theme, fontSize, uiMode, palette, visible, showReaderHotwords);
  }

  function changeReaderHotwords(visible: boolean) {
    setShowReaderHotwords(visible);
    setHasHotwordPreference(true);
    writeLocalSetting(READER_HOTWORDS_STORAGE_KEY, visible ? "show" : "hide");
    applySettings(theme, fontSize, uiMode, palette, showReaderTags, visible);
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
                <strong>{getColorPalette(palette).label}</strong>
              </div>
              <div className="paletteOptions" role="group" aria-label="配色风格">
                {COLOR_PALETTES.map((item) => (
                  <button
                    className={palette === item.value ? "isActive" : ""}
                    key={item.value}
                    type="button"
                    aria-pressed={palette === item.value}
                    onClick={() => changePalette(item.value)}
                  >
                    <span className="paletteSwatches" aria-hidden="true">
                      <span style={{ backgroundColor: item.lightAccent }} />
                      <span style={{ backgroundColor: item.darkAccent }} />
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
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

            {canConfigureContentMeta ? (
              <div className="settingRow">
                <div className="settingRowTitle">
                  <span>内容信息</span>
                </div>
                <div className="settingMetaToggles">
                  <label className="settingToggle">
                    <input type="checkbox" checked={showReaderTags} onChange={(event) => changeReaderTags(event.target.checked)} />
                    <span className="settingToggleTrack" aria-hidden="true" />
                    <span>文章标签</span>
                  </label>
                  <label className="settingToggle">
                    <input type="checkbox" checked={showReaderHotwords} onChange={(event) => changeReaderHotwords(event.target.checked)} />
                    <span className="settingToggleTrack" aria-hidden="true" />
                    <span>文末热词</span>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="previewReader" aria-label="阅读效果预览">
        <p>{previewText}</p>
      </div>
    </section>
  );
}
