"use client";

import { useEffect, useState } from "react";

function readSelection(storageKey: string): number[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "[]") as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0)));
  } catch {
    return [];
  }
}

export function usePersistentSelection(storageKey: string) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loadedKey, setLoadedKey] = useState("");

  useEffect(() => {
    setSelectedIds(readSelection(storageKey));
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey !== storageKey) {
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(selectedIds));
    } catch {
      // Selection still works for the current page when storage is unavailable.
    }
  }, [loadedKey, selectedIds, storageKey]);

  function toggleOne(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function togglePage(visibleIds: number[]) {
    const visible = new Set(visibleIds);
    setSelectedIds((current) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !visible.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function clearSelection() {
    setSelectedIds([]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Selection has already been cleared in memory.
    }
  }

  return { selectedIds, setSelectedIds, toggleOne, togglePage, clearSelection };
}
