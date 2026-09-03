"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  READER_LAYOUT_CHANGE_EVENT,
  READER_PAGE_TURN_CHANGE_EVENT,
} from "@/lib/reader-layout";
import {
  DEFAULT_READER_LINE_HEIGHT,
  getReaderThemeSystemTheme,
  isReaderTheme,
  normalizeReaderLineHeight,
  normalizeReaderJustify,
  normalizeReaderPageTurn,
  normalizeReaderWidth,
  READER_FONT_SIZE_STORAGE_KEY,
  READER_LINE_HEIGHT_STORAGE_KEY,
  READER_JUSTIFY_STORAGE_KEY,
  READER_PAGE_TURN_OPTIONS,
  READER_PAGE_TURN_STORAGE_KEY,
  READER_PAPER_STORAGE_KEY,
  READER_THEME_OPTIONS,
  READER_WIDTH_STORAGE_KEY,
  READER_WIDTHS,
  type ReaderLineHeight,
  type ReaderPageTurn,
  type ReaderTheme,
  type ReaderWidth,
} from "@/lib/ui-preferences";
import { clearReaderPaperPreference } from "@/lib/reader-theme-client";
import { ReaderFontSizeStepper, ReaderLineHeightStepper } from "./ReaderTypographyControls";

const MOBILE_READER_QUERY = "(max-width: 820px)";

function currentGlobalTheme(): "light" | "dark" {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "light" || explicitTheme === "dark") return explicitTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getReaderShell() {
  return document.querySelector<HTMLElement>(".readerShell");
}

function getReadingRatio(pageTurnEnabled: boolean, mode: ReaderPageTurn): number {
  const content = document.querySelector<HTMLElement>(".readerText");
  if (!content) return 0;
  if (pageTurnEnabled && mode !== "scroll") {
    const maximum = Math.max(content.scrollWidth - content.clientWidth, 0);
    return maximum ? Math.min(Math.max(content.scrollLeft / maximum, 0), 1) : 0;
  }
  const contentTop = window.scrollY + content.getBoundingClientRect().top;
  const probe = window.scrollY + window.innerHeight * 0.42;
  return Math.min(Math.max((probe - contentTop) / Math.max(content.scrollHeight, 1), 0), 1);
}

export function useReaderDisplayPreferences({ pageTurnEnabled }: { pageTurnEnabled: boolean }) {
  const [readerTheme, setReaderTheme] = useState<ReaderTheme | null>(null);
  const [globalTheme, setGlobalTheme] = useState<"light" | "dark">("light");
  const [width, setWidth] = useState<ReaderWidth>(800);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState<ReaderLineHeight>(DEFAULT_READER_LINE_HEIGHT);
  const [justified, setJustified] = useState(true);
  const [pageTurn, setPageTurn] = useState<ReaderPageTurn>("scroll");
  const flowRestoreTimer = useRef<number>(0);

  useEffect(() => {
    const root = document.documentElement;
    const shell = getReaderShell();
    if (!shell) return;

    const originalThemeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalThemeColor = originalThemeColorMeta?.getAttribute("content") ?? null;
    let themeColorMeta = originalThemeColorMeta;
    const mobileViewport = window.matchMedia(MOBILE_READER_QUERY);

    function restoreThemeColor() {
      if (!themeColorMeta) return;
      if (themeColorMeta !== originalThemeColorMeta) {
        themeColorMeta.remove();
        themeColorMeta = originalThemeColorMeta;
      } else if (originalThemeColor === null) {
        themeColorMeta.removeAttribute("content");
      } else {
        themeColorMeta.setAttribute("content", originalThemeColor);
      }
    }

    function syncReaderViewportTheme(theme: ReaderTheme | null) {
      const themeOption = READER_THEME_OPTIONS.find((item) => item.value === theme);
      const viewportColor = themeOption
        ? mobileViewport.matches ? themeOption.paper : themeOption.outer
        : getComputedStyle(shell!).getPropertyValue(mobileViewport.matches ? "--reader-paper" : "--reader-bg").trim();
      if (!viewportColor) {
        root.removeAttribute("data-reader-viewport");
        root.style.removeProperty("--reader-viewport-bg");
        restoreThemeColor();
        return;
      }

      root.dataset.readerViewport = "true";
      root.style.setProperty("--reader-viewport-bg", viewportColor);
      if (!themeColorMeta) {
        themeColorMeta = document.createElement("meta");
        themeColorMeta.setAttribute("name", "theme-color");
        document.head.append(themeColorMeta);
      }
      themeColorMeta.setAttribute("content", viewportColor);
    }

    const savedTheme = localStorage.getItem(READER_PAPER_STORAGE_KEY);
    const savedFontSize = Number(localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY));
    const initialReaderTheme = isReaderTheme(savedTheme) ? savedTheme : null;
    const initialGlobalTheme = initialReaderTheme
      ? getReaderThemeSystemTheme(initialReaderTheme)
      : currentGlobalTheme();
    const initialWidth = normalizeReaderWidth(localStorage.getItem(READER_WIDTH_STORAGE_KEY));
    const initialFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 8 && savedFontSize <= 25 ? savedFontSize : 18;
    const initialLineHeight = normalizeReaderLineHeight(
      Number(localStorage.getItem(READER_LINE_HEIGHT_STORAGE_KEY)),
      DEFAULT_READER_LINE_HEIGHT,
    );
    const initialPageTurn = normalizeReaderPageTurn(localStorage.getItem(READER_PAGE_TURN_STORAGE_KEY));
    const initialJustified = normalizeReaderJustify(localStorage.getItem(READER_JUSTIFY_STORAGE_KEY));

    setReaderTheme(initialReaderTheme);
    setGlobalTheme(initialGlobalTheme);
    setWidth(initialWidth);
    setFontSize(initialFontSize);
    setLineHeight(initialLineHeight);
    setPageTurn(initialPageTurn);
    setJustified(initialJustified);
    if (initialReaderTheme) {
      root.dataset.theme = initialGlobalTheme;
      localStorage.setItem("novel-theme", initialGlobalTheme);
      root.dataset.readerTheme = initialReaderTheme;
      shell.dataset.readerTheme = initialReaderTheme;
    } else {
      root.removeAttribute("data-reader-theme");
      shell.removeAttribute("data-reader-theme");
    }
    syncReaderViewportTheme(initialReaderTheme);
    root.dataset.readerWidth = String(initialWidth);
    shell.dataset.readerWidth = String(initialWidth);
    if (pageTurnEnabled) shell.dataset.readerPageTurn = initialPageTurn;
    root.dataset.readerJustify = initialJustified ? "on" : "off";
    shell.dataset.readerJustify = initialJustified ? "on" : "off";
    if (initialWidth === "auto") {
      root.style.removeProperty("--reader-preferred-paper-width");
      shell.style.removeProperty("--reader-paper-width");
    } else {
      root.style.setProperty("--reader-preferred-paper-width", `${initialWidth}px`);
      shell.style.setProperty("--reader-paper-width", `${initialWidth}px`);
    }
    shell.style.setProperty("--reader-font-size", `${initialFontSize}px`);
    shell.style.setProperty("--reader-line-height", String(initialLineHeight));

    const syncGlobalTheme = () => {
      setGlobalTheme(currentGlobalTheme());
      const storedTheme = localStorage.getItem(READER_PAPER_STORAGE_KEY);
      const normalizedTheme = isReaderTheme(storedTheme) ? storedTheme : null;
      setReaderTheme(normalizedTheme);
      syncReaderViewportTheme(normalizedTheme);
    };
    const themeObserver = new MutationObserver(syncGlobalTheme);
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-reader-theme"] });
    systemTheme.addEventListener("change", syncGlobalTheme);
    mobileViewport.addEventListener("change", syncGlobalTheme);
    return () => {
      themeObserver.disconnect();
      systemTheme.removeEventListener("change", syncGlobalTheme);
      mobileViewport.removeEventListener("change", syncGlobalTheme);
      root.removeAttribute("data-reader-viewport");
      root.style.removeProperty("--reader-viewport-bg");
      restoreThemeColor();
      if (flowRestoreTimer.current) window.clearTimeout(flowRestoreTimer.current);
    };
  }, [pageTurnEnabled]);

  function restoreFlowProgress(progressRatio: number) {
    const restore = () => {
      const content = document.querySelector<HTMLElement>(".readerText");
      if (!content) return;
      const contentTop = window.scrollY + content.getBoundingClientRect().top;
      const target = contentTop + content.scrollHeight * progressRatio - window.innerHeight * 0.42;
      window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
    if (flowRestoreTimer.current) window.clearTimeout(flowRestoreTimer.current);
    flowRestoreTimer.current = window.setTimeout(restore, 190);
  }

  function notifyLayout(progressRatio: number) {
    if (pageTurnEnabled) {
      window.dispatchEvent(new CustomEvent(READER_LAYOUT_CHANGE_EVENT, { detail: { progressRatio } }));
    } else {
      restoreFlowProgress(progressRatio);
    }
  }

  function toggleTheme() {
    const nextTheme = currentGlobalTheme() === "dark" ? "light" : "dark";
    setReaderTheme(null);
    setGlobalTheme(nextTheme);
    clearReaderPaperPreference();
    localStorage.setItem("novel-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function changeReaderTheme(nextTheme: ReaderTheme) {
    const selectedTheme = readerTheme === nextTheme ? null : nextTheme;
    const nextGlobalTheme = getReaderThemeSystemTheme(nextTheme);
    const root = document.documentElement;
    const shell = getReaderShell();
    setReaderTheme(selectedTheme);
    setGlobalTheme(nextGlobalTheme);
    localStorage.setItem("novel-theme", nextGlobalTheme);
    root.dataset.theme = nextGlobalTheme;
    if (selectedTheme) {
      localStorage.setItem(READER_PAPER_STORAGE_KEY, selectedTheme);
      root.dataset.readerTheme = selectedTheme;
      if (shell) shell.dataset.readerTheme = selectedTheme;
    } else {
      localStorage.removeItem(READER_PAPER_STORAGE_KEY);
      root.removeAttribute("data-reader-theme");
      shell?.removeAttribute("data-reader-theme");
    }
  }

  function changeWidth(nextWidth: ReaderWidth) {
    const progressRatio = getReadingRatio(pageTurnEnabled, pageTurn);
    const root = document.documentElement;
    const shell = getReaderShell();
    setWidth(nextWidth);
    localStorage.setItem(READER_WIDTH_STORAGE_KEY, String(nextWidth));
    root.dataset.readerWidth = String(nextWidth);
    if (nextWidth === "auto") root.style.removeProperty("--reader-preferred-paper-width");
    else root.style.setProperty("--reader-preferred-paper-width", `${nextWidth}px`);
    if (shell) {
      shell.dataset.readerWidth = String(nextWidth);
      if (nextWidth === "auto") shell.style.removeProperty("--reader-paper-width");
      else shell.style.setProperty("--reader-paper-width", `${nextWidth}px`);
    }
    notifyLayout(progressRatio);
  }

  function changeFontSize(value: number) {
    const progressRatio = getReadingRatio(pageTurnEnabled, pageTurn);
    const nextFontSize = Math.min(25, Math.max(8, value));
    setFontSize(nextFontSize);
    localStorage.setItem(READER_FONT_SIZE_STORAGE_KEY, String(nextFontSize));
    getReaderShell()?.style.setProperty("--reader-font-size", `${nextFontSize}px`);
    document.documentElement.style.setProperty("--reader-font-size", `${nextFontSize}px`);
    notifyLayout(progressRatio);
  }

  function changeLineHeight(nextLineHeight: ReaderLineHeight) {
    const progressRatio = getReadingRatio(pageTurnEnabled, pageTurn);
    setLineHeight(nextLineHeight);
    localStorage.setItem(READER_LINE_HEIGHT_STORAGE_KEY, String(nextLineHeight));
    getReaderShell()?.style.setProperty("--reader-line-height", String(nextLineHeight));
    document.documentElement.style.setProperty("--reader-line-height", String(nextLineHeight));
    notifyLayout(progressRatio);
  }

  function changePageTurn(nextPageTurn: ReaderPageTurn) {
    if (!pageTurnEnabled || pageTurn === nextPageTurn) return;
    const progressRatio = getReadingRatio(true, pageTurn);
    const root = document.documentElement;
    setPageTurn(nextPageTurn);
    localStorage.setItem(READER_PAGE_TURN_STORAGE_KEY, nextPageTurn);
    root.dataset.readerPageTurn = nextPageTurn;
    const shell = getReaderShell();
    if (shell) shell.dataset.readerPageTurn = nextPageTurn;
    window.dispatchEvent(new CustomEvent(READER_PAGE_TURN_CHANGE_EVENT, {
      detail: { mode: nextPageTurn, progressRatio },
    }));
  }

  function changeJustified(nextJustified: boolean) {
    if (justified === nextJustified) return;
    const progressRatio = getReadingRatio(pageTurnEnabled, pageTurn);
    const value = nextJustified ? "on" : "off";
    const root = document.documentElement;
    setJustified(nextJustified);
    localStorage.setItem(READER_JUSTIFY_STORAGE_KEY, value);
    root.dataset.readerJustify = value;
    const shell = getReaderShell();
    if (shell) shell.dataset.readerJustify = value;
    notifyLayout(progressRatio);
  }

  function scrollTop() {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const content = document.querySelector<HTMLElement>(".readerText");
    content?.scrollTo({ left: 0, behavior: reduceMotion || pageTurn === "instant" ? "auto" : "smooth" });
    window.scrollTo({ top: 0, behavior: reduceMotion || pageTurn === "instant" ? "auto" : "smooth" });
  }

  return {
    changeFontSize,
    changeLineHeight,
    changeJustified,
    changePageTurn,
    changeReaderTheme,
    changeWidth,
    fontSize,
    lineHeight,
    justified,
    pageTurn,
    readerIsDark: readerTheme ? readerTheme === "night" : globalTheme === "dark",
    readerTheme,
    scrollTop,
    toggleTheme,
    width,
  };
}

type ReaderDisplayPreferences = ReturnType<typeof useReaderDisplayPreferences>;

export function ReaderThemePicker({
  value,
  onChange,
  labelFor = (label) => label,
  className = "",
}: {
  value: ReaderTheme | null;
  onChange: (value: ReaderTheme) => void;
  labelFor?: (label: string) => string;
  className?: string;
}) {
  return (
    <div className={`readerThemePicker${className ? ` ${className}` : ""}`} role="group" aria-label={labelFor("主题")}>
      {READER_THEME_OPTIONS.map((item) => (
        <button
          className={value === item.value ? "isActive" : ""}
          data-reader-theme-value={item.value}
          type="button"
          key={item.value}
          onClick={() => onChange(item.value)}
          aria-label={labelFor(item.label)}
          aria-pressed={value === item.value}
          style={{ "--reader-theme-swatch": item.swatch } as CSSProperties}
        >
          {value === item.value ? <Check size={18} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

export function ReaderJustifyToggle({
  checked,
  onChange,
  label = "两端对齐",
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label className={`settingToggle readerJustifyToggle${className ? ` ${className}` : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <span className="settingToggleTrack" aria-hidden="true"><span /></span>
    </label>
  );
}

export function ReaderDisplaySettingsPanel({
  preferences,
  showPageTurn,
  showJustify = false,
}: {
  preferences: ReaderDisplayPreferences;
  showPageTurn: boolean;
  showJustify?: boolean;
}) {
  return (
    <div className="readerSettingsPanel">
      <div className="readerSettingRow isThemes">
        <span>主题</span>
        <ReaderThemePicker value={preferences.readerTheme} onChange={preferences.changeReaderTheme} />
      </div>
      <div className="readerSettingRow isFontSize">
        <span>字号</span>
        <ReaderFontSizeStepper value={preferences.fontSize} onChange={preferences.changeFontSize} />
      </div>
      <div className="readerSettingRow isLineHeight">
        <span>行距</span>
        <ReaderLineHeightStepper value={preferences.lineHeight} onChange={preferences.changeLineHeight} />
      </div>
      {showJustify ? (
        <div className="readerSettingRow isJustify">
          <span>两端对齐</span>
          <ReaderJustifyToggle checked={preferences.justified} onChange={preferences.changeJustified} />
        </div>
      ) : null}
      {showPageTurn ? (
        <div className="readerSettingRow isPageTurn">
          <span>翻页方式</span>
          <div role="group" aria-label="翻页方式">
            {READER_PAGE_TURN_OPTIONS.map((item) => (
              <button
                className={preferences.pageTurn === item.value ? "isActive" : ""}
                type="button"
                key={item.value}
                onClick={() => preferences.changePageTurn(item.value)}
                aria-pressed={preferences.pageTurn === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="readerSettingRow isWidth">
        <span>页面宽度</span>
        <div role="group" aria-label="页面宽度">
          {READER_WIDTHS.map((item) => (
            <button
              className={preferences.width === item ? "isActive" : ""}
              type="button"
              key={item}
              onClick={() => preferences.changeWidth(item)}
              aria-pressed={preferences.width === item}
            >
              {item === "auto" ? "自动" : item}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
