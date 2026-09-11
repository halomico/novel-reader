"use client";

import { useEffect } from "react";
import {
  isColorPalette,
  PALETTE_STORAGE_KEY,
  resolveDefaultPalette,
  type ColorPalette,
} from "@/lib/ui-preferences";
import { applyColorPalette as applyPalette } from "@/lib/palette-client";

export function DefaultPaletteRotation({
  fallback,
  enabled,
  intervalMinutes,
}: {
  fallback: ColorPalette;
  enabled: boolean;
  intervalMinutes: number;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const intervalMs = Math.max(1, Math.floor(intervalMinutes)) * 60_000;
    let timer = 0;
    const refresh = () => {
      let savedPalette: string | null = null;
      try {
        savedPalette = localStorage.getItem(PALETTE_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
      if (!isColorPalette(savedPalette)) {
        applyPalette(resolveDefaultPalette(fallback, true, intervalMinutes));
      }
      const delay = intervalMs - (Date.now() % intervalMs) + 50;
      timer = window.setTimeout(refresh, delay);
    };

    refresh();
    return () => window.clearTimeout(timer);
  }, [enabled, fallback, intervalMinutes]);

  return null;
}
