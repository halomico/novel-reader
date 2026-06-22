"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

const themes: Array<{ value: ThemeChoice; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
];

function applySettings(theme: ThemeChoice, fontSize: number, pageSize: number) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }

  document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
  localStorage.setItem("novel-theme", theme);
  localStorage.setItem("novel-font-size", String(fontSize));
  localStorage.setItem("novel-page-size", String(pageSize));
  document.cookie = `novel-page-size=${pageSize}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function SettingsPanel({ previewText }: { previewText: string }) {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [fontSize, setFontSize] = useState(19);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    const savedTheme = localStorage.getItem("novel-theme") as ThemeChoice | null;
    const savedFontSize = Number(localStorage.getItem("novel-font-size"));
    const savedPageSize = Number(localStorage.getItem("novel-page-size"));
    const nextTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
    const nextFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 5 && savedFontSize <= 50 ? savedFontSize : 19;
    const nextPageSize = Number.isFinite(savedPageSize) && savedPageSize >= 1 && savedPageSize <= 50 ? savedPageSize : 15;

    setTheme(nextTheme);
    setFontSize(nextFontSize);
    setPageSize(nextPageSize);
    applySettings(nextTheme, nextFontSize, nextPageSize);
  }, []);

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    applySettings(value, fontSize, pageSize);
  }

  function changeFontSize(value: number) {
    setFontSize(value);
    applySettings(theme, value, pageSize);
  }

  function changePageSize(value: number) {
    const nextPageSize = Math.min(Math.max(Math.floor(value), 1), 50);
    setPageSize(nextPageSize);
    applySettings(theme, fontSize, nextPageSize);
  }

  return (
    <section className="settingsPanel" aria-label="阅读设置">
      <div className="settingBlock">
        <h2>主题</h2>
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
        <h2>字号</h2>
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
          <strong>{fontSize} px</strong>
        </div>
      </div>

      <div className="settingBlock">
        <h2>每页数量</h2>
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
          <strong>{pageSize} 本</strong>
        </div>
      </div>

      <div className="previewReader" aria-label="阅读效果预览">
        <p>{previewText}</p>
      </div>
    </section>
  );
}
