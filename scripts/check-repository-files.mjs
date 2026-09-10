import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Inspect paths/modes only. Never read or print private file contents, remote
// URLs, commit messages, credentials or Git's raw diagnostic output.
function git(args, input, allowed = [0]) {
  const result = spawnSync("git", ["-c", `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], {
    input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || !allowed.includes(result.status)) throw new Error("Git inspection failed; fetch the destination refs before retrying.");
  return result.stdout;
}

const problems = new Set();
const paths = new Set();

function collect(records, index = false) {
  for (const record of records.split("\0").filter(Boolean)) {
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error("Invalid Git tree entry.");
    const metadata = record.slice(0, separator).split(" ");
    const name = record.slice(separator + 1);
    paths.add(name);
    if (!["100644", "100755"].includes(metadata[0]) || (index && metadata[2] !== "0")) {
      problems.add(`${name}: unsupported link, submodule or unresolved index entry`);
    }
  }
}

function inspectCommits(local, remote, remoteName) {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(local) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(remote)) {
    throw new Error("Invalid push revision.");
  }
  if (/^0+$/.test(local)) return; // Deleting a ref sends no new source objects.
  let exclusions = [];
  if (!/^0+$/.test(remote)) {
    exclusions = [`^${remote}`];
  } else if (/^[a-zA-Z0-9._-]+$/.test(remoteName ?? "")) {
    // For a new branch exclude only history already known on this destination.
    // Pushing directly to a URL has no trusted tracking refs: inspect all history.
    exclusions = git(["for-each-ref", "--format=%(objectname)", `refs/remotes/${remoteName}/`])
      .trim().split("\n").filter(Boolean).map((oid) => `^${oid}`);
  }
  const revisions = git(["rev-list", local, ...exclusions]).trim().split("\n").filter(Boolean);
  // Inspect every newly published change, not just the final diff: deleting a
  // secret later does not stop its earlier commit/blob from being transferred.
  // Unchanged files that already exist on the destination are not re-submitted.
  for (const revision of revisions) {
    const changed = git([
      "diff-tree", "--root", "-m", "-r", "--no-renames", "--no-commit-id",
      "--diff-filter=ACMRTUXB", "--name-only", "-z", revision,
    ]);
    for (const name of changed.split("\0").filter(Boolean)) paths.add(name);
  }
}

function inspectPaths() {
  const names = [...paths];
  // Bounded batches avoid platform command/output size limits on large histories.
  for (let offset = 0; offset < names.length; offset += 1000) {
    const ignored = git(["check-ignore", "--no-index", "--stdin", "-z"],
      names.slice(offset, offset + 1000).join("\0") + "\0", [0, 1]);
    for (const name of ignored.split("\0").filter(Boolean)) problems.add(`${name}: outside the repository allowlist`);
  }
}

try {
  const mode = process.argv[2];
  if (!mode) {
    collect(git(["ls-files", "--stage", "-z"]), true);
    if (!paths.size) throw new Error("A nonempty Git index is required.");
  } else if (mode === "--pending") {
    inspectCommits(git(["rev-parse", "HEAD"]).trim(), git(["rev-parse", "@{upstream}"]).trim());
  } else if (mode === "--pre-push") {
    const updates = readFileSync(0, "utf8");
    if (updates.length > 1024 * 1024) throw new Error("Too many push updates.");
    for (const line of updates.trim().split("\n").filter(Boolean)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error("Invalid push update.");
      inspectCommits(fields[1], fields[3], process.argv[3]);
    }
  } else throw new Error("Unknown repository scope check mode.");
  inspectPaths();
  for (const problem of [...problems].sort()) console.error(JSON.stringify(problem));
  console.log(`Repository scope: ${problems.size ? "FAIL" : "PASS"} (${problems.size} findings)`);
  if (problems.size) {
    console.error("Keep local files on disk. Clean the index or unpublished history before committing/pushing; no history was changed by this check.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Repository scope check failed.");
  process.exitCode = 1;
}
