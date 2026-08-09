const TEMPORARY_SUFFIXES = [
  ".part",
  ".tmp",
  ".session.json",
  ".complete.json",
] as const;

export function isIgnoredMediaStorageEntry(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase("en-US");
  return (
    !normalized ||
    normalized.startsWith(".") ||
    TEMPORARY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}
