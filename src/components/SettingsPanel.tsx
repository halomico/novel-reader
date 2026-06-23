"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

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

function applySettings(theme: ThemeChoice, fontSize: number, pageSize: number, uiMode: UiMode) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }

  document.documentElement.dataset.uiMode = uiMode;
  document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
  localStorage.setItem("novel-theme", theme);
  localStorage.setItem("novel-font-size", String(fontSize));
  localStorage.setItem("novel-page-size", String(pageSize));
  localStorage.setItem("novel-ui-mode", uiMode);
  document.cookie = `novel-page-size=${pageSize}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function SettingsPanel({ previewText }: { previewText: string }) {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [uiMode, setUiMode] = useState<UiMode>("standard");
  const [fontSize, setFontSize] = useState(19);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    const savedTheme = localStorage.getItem("novel-theme") as ThemeChoice | null;
    const savedUiMode = localStorage.getItem("novel-ui-mode") as UiMode | null;
    const savedFontSize = Number(localStorage.getItem("novel-font-size"));
    const savedPageSize = Number(localStorage.getItem("novel-page-size"));
    const nextTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
    const nextUiMode = savedUiMode === "minimal" || savedUiMode === "standard" ? savedUiMode : "standard";
    const nextFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 5 && savedFontSize <= 50 ? savedFontSize : 19;
    const nextPageSize = Number.isFinite(savedPageSize) && savedPageSize >= 1 && savedPageSize <= 50 ? savedPageSize : 15;

    setTheme(nextTheme);
    setUiMode(nextUiMode);
    setFontSize(nextFontSize);
    setPageSize(nextPageSize);
    applySettings(nextTheme, nextFontSize, nextPageSize, nextUiMode);
  }, []);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    applySettings(value, fontSize, pageSize, uiMode);
  }

  function changeUiMode(value: UiMode) {
    setUiMode(value);
    applySettings(theme, fontSize, pageSize, value);
  }

  function changeFontSize(value: number) {
    setFontSize(value);
    applySettings(theme, value, pageSize, uiMode);
  }

  function changePageSize(value: number) {
    const nextPageSize = Math.min(Math.max(Math.floor(value), 1), 50);
    setPageSize(nextPageSize);
    applySettings(theme, fontSize, nextPageSize, uiMode);
  }

  return (
    <section className="settingsPanel" aria-label="阅读设置">
      <div className="settingsGrid">
        <div className="settingBlock">
          <div className="settingBlockHeader">
            <h2>模式</h2>
            <strong>{uiMode === "minimal" ? "极简" : "标准"}</strong>
          </div>
          <div className="segmentedControl" role="group" aria-label="界面模式">
            {uiModes.map((item) => (
              <button
                className={uiMode === item.value ? "isActive" : ""}
                key={item.value}
                type="button"
                onClick={() => changeUiMode(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settingBlock">
          <div className="settingBlockHeader">
            <h2>主题</h2>
            <strong>{themes.find((item) => item.value === theme)?.label}</strong>
          </div>
          <div className="segmentedControl" role="group" aria-label="主题模式">
            {themes.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={theme === item.value ? "isActive" : ""}
                  key={item.value}
                  type="button"
                  onClick={() => changeTheme(item.value)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settingBlock">
          <div className="settingBlockHeader">
            <h2>字号</h2>
            <strong>{fontSize} px</strong>
          </div>
          <div className="rangeRow">
            <span>5</span>
            <input
              aria-label="正文字号"
              type="range"
              min="5"
              max="50"
              step="1"
              value={fontSize}
              onChange={(event) => changeFontSize(Number(event.target.value))}
            />
            <span>50</span>
          </div>
        </div>

        <div className="settingBlock">
          <div className="settingBlockHeader">
            <h2>每页数量</h2>
            <strong>{pageSize} 本</strong>
          </div>
          <div className="rangeRow">
            <span>1</span>
            <input
              aria-label="每页显示小说数量"
              type="range"
              min="1"
              max="50"
              step="1"
              value={pageSize}
              onChange={(event) => changePageSize(Number(event.target.value))}
            />
            <span>50</span>
          </div>
        </div>
      </div>

      <div className="previewReader" aria-label="阅读效果预览">
        <p>{previewText}</p>
      </div>
    </section>
  );
}
