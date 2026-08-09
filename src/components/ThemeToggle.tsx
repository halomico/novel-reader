"use client";

import { Moon, Sun } from "lucide-react";
import { clearReaderPaperPreference } from "@/lib/reader-theme-client";

function applyTheme(theme: "light" | "dark") {
  clearReaderPaperPreference();
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("novel-theme", theme);
  } catch {
    // The selected theme still applies for the current page.
  }
}

export function ThemeToggle() {
  function toggleTheme() {
    const explicitTheme = document.documentElement.dataset.theme;
    const currentTheme = explicitTheme === "dark"
      || (explicitTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
    applyTheme(currentTheme === "dark" ? "light" : "dark");
  }

  return (
    <button
      className="iconLink themeToggle"
      type="button"
      onClick={toggleTheme}
      aria-label="切换明暗模式"
      title="切换明暗模式"
    >
      <Sun className="themeToggleSun" size={21} aria-hidden="true" />
      <Moon className="themeToggleMoon" size={21} aria-hidden="true" />
    </button>
  );
}
