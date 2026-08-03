import { READER_PAPER_STORAGE_KEY } from "./ui-preferences";

type AttributeTarget = { removeAttribute(name: string): void };
type PreferenceStorage = { removeItem(key: string): void };

export function clearReaderPaperPreference(options: {
  storage?: PreferenceStorage;
  root?: AttributeTarget;
  shells?: Iterable<AttributeTarget>;
} = {}) {
  const storage = options.storage ?? localStorage;
  const root = options.root ?? document.documentElement;
  const shells = options.shells ?? document.querySelectorAll<HTMLElement>(".readerShell[data-reader-theme]");

  try {
    storage.removeItem(READER_PAPER_STORAGE_KEY);
  } catch {
    // The in-memory theme can still fall back to the system surface.
  }
  root.removeAttribute("data-reader-theme");
  for (const shell of shells) shell.removeAttribute("data-reader-theme");
}
