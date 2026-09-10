"""Audit every layer of a `docker image save` archive, without extracting it.

Never print file contents, environment values or build history: they may be
secrets. A later whiteout does not erase a leaked file from a published layer.
This checks artifact hygiene, not arbitrary secrets hard-coded in source code.
"""

import argparse
import json
import os
import posixpath
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath


MAINTENANCE = {
    "scan-books.js", "reindex-postgres-content.js", "reindex-postgres-originals.js",
    "optimize-media.js", "media-node.js", "postgres-content-worker.js",
    "db-migrate-postgres.js", "db-verify-postgres.js", "init-postgres.js",
    "package.json",
}
PRIVATE_SUFFIX = re.compile(r"\.(?:db(?:-.*)?|sqlite[0-9]*(?:-.*)?|pem|key|p12|pfx|log|bak)$", re.I)
PRIVATE_ENV = re.compile(r"(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL|SMTP_URL|API_KEY)", re.I)


def normalized_path(name):
    if "\\" in name or ".." in PurePosixPath(name).parts:
        raise ValueError("unsafe archive member path")
    return name.lstrip("/").removeprefix("./").rstrip("/")


def private_path(name):
    parts = PurePosixPath(name).parts
    if not parts or parts[0] != "app":
        return False
    if any(p.startswith(".env") or p in {".git", ".ssh", ".npmrc", "id_rsa", "id_ed25519"} for p in parts):
        return True
    if PRIVATE_SUFFIX.search(parts[-1]):
        return True
    if len(parts) == 2:
        return parts[1] not in {"server.js", "package.json", "LICENSE", "THIRD_PARTY_NOTICES.md"}
    if len(parts) > 2 and parts[1] not in {".next", "node_modules", "maintenance", "migrations", "public"}:
        return True
    if len(parts) > 2 and parts[1] in {"data", "library", "backups", "deploy", "docs", "src", "scripts"}:
        return True
    if len(parts) > 2 and parts[1] == "maintenance" and (len(parts) != 3 or parts[2] not in MAINTENANCE):
        return True
    if len(parts) > 2 and parts[1] == "migrations":
        return len(parts) != 4 or parts[2] != "postgres" or not re.fullmatch(r"[0-9]{4}_[a-z0-9_-]+\.sql", parts[3])
    if len(parts) > 2 and parts[1] == "public":
        return not (name == "app/public/favicon.ico" or (
            parts[2] in {"default-avatars", "avatar-widgets"} and name.endswith(".svg")
        ))
    return False


def scan_stream(stream, markers):
    found = set()
    carry = b""
    overlap = max((len(marker) for marker in markers), default=1) - 1
    while block := stream.read(1024 * 1024):
        data = carry + block
        found.update(label for marker, label in markers.items() if marker in data)
        carry = data[-overlap:] if overlap else b""
    return found


def code_markers(name, require_postgres):
    if require_postgres and name.endswith((".js", ".cjs", ".mjs")) and (
        name.startswith("app/.next/server/") or name.startswith("app/maintenance/")
    ):
        return {b"node:sqlite": "legacy SQLite runtime"}
    return {}


def audit_image(archive_path, *, canary=None, require_postgres=False):
    findings = set()
    markers = {canary.encode(): "private build-context canary"} if canary else {}
    with tarfile.open(archive_path, "r:*") as archive:
        # Do not extract host paths, follow archive links or silently select a
        # different image/config when given a multi-image archive.
        names = [item.name for item in archive.getmembers()]
        if len(names) != len(set(names)):
            raise ValueError("ambiguous image archive")

        def read_json(name):
            member = archive.getmember(name)
            if not member.isfile() or member.size > 8 * 1024 * 1024:
                raise ValueError("invalid image metadata")
            with archive.extractfile(member) as stream:
                raw = stream.read()
            if any(marker in raw for marker in markers):
                findings.add("image metadata: private build-context canary")
            return json.loads(raw)

        manifest = read_json("manifest.json")
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise ValueError("save exactly one candidate image for auditing")
        config = read_json(manifest[0]["Config"])
        runtime = config.get("config") or {}
        if runtime.get("User", "").split(":")[0] in {"", "0", "root"}:
            findings.add("image config: runtime must be non-root")
        for item in runtime.get("Env") or []:
            key, _, value = item.partition("=")
            if value and PRIVATE_ENV.search(key):
                findings.add("image config: baked-in private environment setting")
            if require_postgres and key in {"DATABASE_PATH", "CONTENT_SEARCH_INDEX_DIR"}:
                findings.add("image config: legacy SQLite storage setting")
        for entry in config.get("history") or []:
            history = entry.get("created_by", "")
            if re.search(r"\b(?:\w*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL|SMTP_URL|API_KEY)\w*)=\S+", history, re.I):
                findings.add("image history: private build argument or environment assignment")

        layers = manifest[0].get("Layers")
        if not isinstance(layers, list) or not layers:
            raise ValueError("image has no layers")
        for layer_name in layers:
            member = archive.getmember(layer_name)
            if not member.isfile():
                raise ValueError("invalid image layer")
            with archive.extractfile(member) as raw_layer, tarfile.open(fileobj=raw_layer, mode="r|*") as layer:
                for item in layer:
                    name = normalized_path(item.name)
                    if item.isdir():
                        continue  # Empty mount points are safe; their contents are not.
                    if private_path(name):
                        findings.add(f"{name}: forbidden runtime file")
                    if (item.issym() or item.islnk()) and name.startswith("app/"):
                        target = item.linkname
                        if item.issym() and not target.startswith("/"):
                            target = posixpath.join(posixpath.dirname(name), target)
                        target = posixpath.normpath(target).lstrip("/")
                        if not target.startswith("app/") or private_path(target):
                            findings.add(f"{name}: unsafe application link")
                    if item.isfile():
                        with layer.extractfile(item) as stream:
                            for reason in scan_stream(stream, markers | code_markers(name, require_postgres)):
                                findings.add(f"{name}: {reason}")
    return sorted(findings)


def audit_directory(directory, *, require_postgres=False):
    """Diagnostic for local Next output; NOT a substitute for the layer audit."""
    findings = set()
    for path in Path(directory).rglob("*"):
        name = "app/" + path.relative_to(directory).as_posix()
        if path.is_symlink():
            # Local standalone is generated, and has no reason to link private
            # host files. Docker-layer audit handles container-relative links.
            findings.add(f"{name}: local standalone symlink requires review")
        elif path.is_file():
            if private_path(name):
                findings.add(f"{name}: forbidden runtime file")
            with path.open("rb") as stream:
                for reason in scan_stream(stream, code_markers(name, require_postgres)):
                    findings.add(f"{name}: {reason}")
    return sorted(findings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image-tar", type=Path)
    source.add_argument("--directory", type=Path)
    parser.add_argument("--require-postgres", action="store_true")
    parser.add_argument("--canary-env", help="Name of the environment variable holding the synthetic canary")
    args = parser.parse_args()
    try:
        if args.directory and not args.directory.is_dir():
            raise ValueError("standalone directory does not exist")
        canary = os.environ.get(args.canary_env) if args.canary_env else None
        if args.canary_env and (not canary or len(canary) < 16):
            raise ValueError("missing or invalid synthetic canary")
        findings = (audit_directory(args.directory, require_postgres=args.require_postgres)
                    if args.directory else audit_image(args.image_tar, canary=canary, require_postgres=args.require_postgres))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, tarfile.TarError):
        # A malformed archive must never pass. Do not echo raw metadata/errors.
        print("Image audit could not read a valid artifact.", file=sys.stderr)
        return 1
    for finding in findings:
        print(json.dumps(finding, ensure_ascii=True), file=sys.stderr)
    print(f"Image audit: {'FAIL' if findings else 'PASS'} ({len(findings)} findings)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
