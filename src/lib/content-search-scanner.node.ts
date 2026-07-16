import { spawn } from "node:child_process";
import { getRipgrepPath } from "./config";
import { normalizeSearchText } from "./search-query";

export type ContentCandidateScanResult = {
  engine: "ripgrep";
  relativePaths: Set<string>;
};

type ContentCandidateScanOptions = {
  isCancelled?: () => boolean;
};

type RipgrepRunResult = {
  ok: boolean;
  cancelled: boolean;
  relativePaths: Set<string>;
};

const SEARCH_ENCODINGS = ["auto", "gb18030"] as const;
const IGNORED_BETWEEN_CHARS_PATTERN = "[\\s\\p{P}\\p{S}]*";

function escapeRegexChar(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function buildRipgrepAnchorPattern(anchorTerm: string): string {
  return Array.from(normalizeSearchText(anchorTerm)).map(escapeRegexChar).join(IGNORED_BETWEEN_CHARS_PATTERN);
}

export function normalizeRipgrepRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

export function createRipgrepSearchArgs(anchorTerm: string, encoding: (typeof SEARCH_ENCODINGS)[number]): string[] {
  return [
    "--no-config",
    "--files-with-matches",
    "--null",
    "--text",
    "--multiline",
    "--hidden",
    "--no-ignore",
    "--no-messages",
    "--color=never",
    "--ignore-case",
    "--threads=1",
    "--iglob=*.txt",
    `--encoding=${encoding}`,
    "--regexp",
    buildRipgrepAnchorPattern(anchorTerm),
    ".",
  ];
}

function runRipgrep(
  executable: string,
  libraryDir: string,
  anchorTerm: string,
  encoding: (typeof SEARCH_ENCODINGS)[number],
  options: ContentCandidateScanOptions,
): Promise<RipgrepRunResult> {
  return new Promise((resolve) => {
    const relativePaths = new Set<string>();
    let pendingOutput = "";
    let cancelled = false;
    let finished = false;
    const child = spawn(executable, createRipgrepSearchArgs(anchorTerm, encoding), {
      cwd: libraryDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const finish = (result: RipgrepRunResult) => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(cancelTimer);
      resolve(result);
    };
    const consumeOutput = (value: string, flush = false) => {
      pendingOutput += value;
      const paths = pendingOutput.split("\0");
      pendingOutput = paths.pop() || "";
      if (flush && pendingOutput) {
        paths.push(pendingOutput);
        pendingOutput = "";
      }
      for (const item of paths) {
        const normalized = normalizeRipgrepRelativePath(item);
        if (normalized) {
          relativePaths.add(normalized);
        }
      }
    };
    const cancelTimer = setInterval(() => {
      if (options.isCancelled?.()) {
        cancelled = true;
        child.kill();
      }
    }, 100);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => consumeOutput(chunk));
    child.on("error", () => finish({ ok: false, cancelled, relativePaths }));
    child.on("close", (code) => {
      consumeOutput("", true);
      finish({ ok: !cancelled && (code === 0 || code === 1), cancelled, relativePaths });
    });
  });
}

export async function scanContentCandidatePaths(
  libraryDir: string,
  anchorTerm: string,
  options: ContentCandidateScanOptions = {},
): Promise<ContentCandidateScanResult | null> {
  if (!buildRipgrepAnchorPattern(anchorTerm)) {
    return null;
  }

  const relativePaths = new Set<string>();
  for (const encoding of SEARCH_ENCODINGS) {
    const result = await runRipgrep(getRipgrepPath(), libraryDir, anchorTerm, encoding, options);
    if (!result.ok) {
      return null;
    }
    for (const relativePath of result.relativePaths) {
      relativePaths.add(relativePath);
    }
  }

  return { engine: "ripgrep", relativePaths };
}
