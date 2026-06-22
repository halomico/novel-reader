"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("novel-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("novel-theme");
    const initialTheme = savedTheme === "dark" || (savedTheme !== "light" && prefersDark()) ? "dark" : "light";
    setTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      className="iconLink themeToggle"
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "切换浅色模式" : "切换暗色模式"}
      title={theme === "dark" ? "切换浅色模式" : "切换暗色模式"}
    >
      <Icon size={21} aria-hidden="true" />
    </button>
  );
}
