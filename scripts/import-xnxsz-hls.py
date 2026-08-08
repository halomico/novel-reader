#!/usr/bin/env python3
"""Import public xnxsz HLS manifests into the remote media-node cluster.

The source catalog is read-only. Each node receives a small bounded number of
ffmpeg remux jobs; no source MP4 is written and no video stream is transcoded.
"""

from __future__ import annotations

import argparse
import fcntl
import html
import json
import os
import re
import secrets
import shlex
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_DB = Path(os.environ.get("DATABASE_PATH", PROJECT_ROOT / "data/novels.db")).resolve()
STATE_DIR = Path(os.environ.get("XNXSZ_HLS_STATE_DIR", PROJECT_ROOT / "data/xnxsz-hls-import")).resolve()
STATE_DB = STATE_DIR / "state.sqlite3"
STATUS_PATH = STATE_DIR / "status.json"
LOCK_PATH = STATE_DIR / "scheduler.lock"
SAFETY_BYTES = int(os.environ.get("XNXSZ_HLS_SAFETY_BYTES", 300 * 1024**3))
DEFAULT_ESTIMATE_BYTES = 512 * 1024**2
REMOTE_TIMEOUT_SECONDS = int(os.environ.get("XNXSZ_HLS_REMOTE_TIMEOUT_SECONDS", 12 * 60 * 60))
NODE_CONCURRENCY = max(1, int(os.environ.get("XNXSZ_NODE_CONCURRENCY", "2")))
SOURCE_HOST = os.environ.get("XNXSZ_SOURCE_HOST", "192.255.182.67")
SOURCE_PASSWORD = os.environ.get("XNXSZ_SOURCE_PASSWORD", "")
SOURCE_DB_PATH = os.environ.get("XNXSZ_SOURCE_DB", "/root/xnxsz_cluster/catalog.db")
SOURCE_QUERY = """
WITH sorted_tags AS (
  SELECT pt.post_id, t.name, t.item_count
  FROM post_terms pt
  JOIN terms t ON t.taxonomy = pt.taxonomy AND t.term_id = pt.term_id
  WHERE pt.taxonomy = 'post_tag'
  ORDER BY pt.post_id, t.item_count DESC, t.name
), post_tags AS (
  SELECT post_id,
         json_group_array(json_object('name', name, 'item_count', item_count)) AS tag_names_json
  FROM sorted_tags
  GROUP BY post_id
)
SELECT p.post_id, p.title, p.post_url, p.manifest_url, p.gif_url,
       p.published_at, p.modified_at,
       COALESCE(post_tags.tag_names_json, '[]') AS tag_names_json,
       COALESCE(j.file_size, 0) AS estimated_bytes
FROM posts p
LEFT JOIN jobs j ON j.post_id = p.post_id
LEFT JOIN post_tags ON post_tags.post_id = p.post_id
WHERE p.manifest_url IS NOT NULL AND p.manifest_url <> ''
ORDER BY COALESCE(p.modified_at, p.published_at, '') DESC, p.post_id DESC
""".strip()

TITLE_PREFIX_RE = re.compile(r"^\s*[【\[\(（<《「『](.+?)[】\]\)）>》」』]\s*")
TITLE_SEPARATOR_CHARS = r"\s\-—–_:：|/·•!！,，。.;；、?？~"
TITLE_SEPARATOR_RE = re.compile(rf"^[{TITLE_SEPARATOR_CHARS}]+")
TITLE_CODE_TOKEN = (
    r"(?:(?:JS|YC|BF|RS|NO|AI)[-_.]?\d{2,}(?:[-_~]\d+)*(?:[（(]\d+[）)])?"
    r"|A\d{2,}(?:[-_~]\d+)*(?:[（(]\d+[）)])?"
    r"|\d{4}[-_.]\d{2}[-_.]\d{2}"
    r"|\d{6,}(?:[-_~]\d+)*(?:[（(]\d+[）)])?)"
)
TITLE_CODE_SUFFIX_RE = re.compile(
    rf"(?:[{TITLE_SEPARATOR_CHARS}]*{TITLE_CODE_TOKEN})+$",
    re.IGNORECASE,
)
TITLE_CODE_PREFIX_RE = re.compile(rf"^\s*{TITLE_CODE_TOKEN}[{TITLE_SEPARATOR_CHARS}]+", re.IGNORECASE)
TITLE_COPY_SUFFIX_RE = re.compile(r"(?:\s*[（(]\d+[）)])+$")
CODE_LIKE_RE = re.compile(
    rf"(?:{TITLE_CODE_TOKEN}|YC-\d|NO\.|RS\.|BF\d|\d{{6,}})",
    re.IGNORECASE,
)
TAG_SPLIT_RE = re.compile(r"[、,，/&＋+|｜·•\s]+")
NOISY_CATEGORY_NAMES = {"在线播放"}
LINE_TAG_BY_NODE = {
    "video-a": "线路0",
    "storage-01": "线路1",
    "storage-02": "线路2",
    "storage-03": "线路3",
    "storage-04": "线路4",
    "storage-05": "线路5",
    "storage-06": "线路6",
}


@dataclass(frozen=True)
class Node:
    id: str
    host: str
    root: str
    password: str


def node_config() -> list[Node]:
    values = [
        ("storage-01", os.environ.get("XNXSZ_STORAGE_01_HOST", "107.174.26.228"), "/opt/novel-reader-media/data/media", "XNXSZ_STORAGE_01_PASSWORD"),
        ("storage-02", os.environ.get("XNXSZ_STORAGE_02_HOST", "192.210.233.69"), "/root/novel-reader-media", "XNXSZ_STORAGE_02_PASSWORD"),
        ("storage-03", os.environ.get("XNXSZ_STORAGE_03_HOST", "192.210.233.67"), "/root/novel-reader-media", "XNXSZ_STORAGE_03_PASSWORD"),
        ("storage-04", os.environ.get("XNXSZ_STORAGE_04_HOST", "192.210.233.70"), "/root/novel-reader-media", "XNXSZ_STORAGE_04_PASSWORD"),
        ("storage-05", os.environ.get("XNXSZ_STORAGE_05_HOST", "192.210.198.158"), "/root/novel-reader-media", "XNXSZ_STORAGE_05_PASSWORD"),
        ("storage-06", os.environ.get("XNXSZ_STORAGE_06_HOST", "192.210.233.68"), "/root/novel-reader-media", "XNXSZ_STORAGE_06_PASSWORD"),
        ("video-a", os.environ.get("XNXSZ_VIDEO_HOST", "172.245.215.188"), "/opt/novel-reader/data/media", "XNXSZ_VIDEO_PASSWORD"),
    ]
    nodes = [Node(node_id, host, root, os.environ.get(password_name, "")) for node_id, host, root, password_name in values]
    missing = [node.id for node in nodes if not node.password]
    if SOURCE_PASSWORD == "" or missing:
        raise RuntimeError(f"缺少调度器 SSH 密钥环境变量：源站={'否' if not SOURCE_PASSWORD else '是'}，节点={','.join(missing) or '无'}")
    return nodes


def clean_text(value: Any) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()


def strip_separators(value: str) -> str:
    current = clean_text(value)
    while True:
        updated = TITLE_SEPARATOR_RE.sub("", current).strip()
        if updated == current:
            return updated
        current = updated


def split_prefixes(title: str) -> tuple[list[str], str]:
    working = clean_text(title)
    prefixes: list[str] = []
    while True:
        match = TITLE_PREFIX_RE.match(working)
        if not match:
            break
        prefix = clean_text(match.group(1))
        if prefix:
            prefixes.append(prefix)
        working = strip_separators(working[match.end():])
    return prefixes, working


def split_tag_text(text: str) -> list[str]:
    cleaned = clean_text(text)
    return [part.strip() for part in TAG_SPLIT_RE.split(cleaned) if part.strip()]


def keep_caption_tag(name: str, item_count: int, *, from_title: bool = False) -> bool:
    cleaned = clean_text(name).strip()
    if not cleaned or cleaned in NOISY_CATEGORY_NAMES:
        return False
    if CODE_LIKE_RE.search(cleaned):
        return False
    if len(cleaned) > 18:
        return False
    if not from_title and item_count <= 1 and (len(cleaned) == 1 or len(cleaned) > 6):
        return False
    return True


def title_prefix_tags(title: str) -> list[str]:
    prefixes, _ = split_prefixes(title)
    result: list[str] = []
    seen: set[str] = set()
    for prefix in prefixes:
        for part in split_tag_text(prefix):
            if not keep_caption_tag(part, 2, from_title=True) or part in seen:
                continue
            seen.add(part)
            result.append(part)
    return result


def caption_tags(title: str, source_tags: list[dict[str, Any]]) -> list[str]:
    picked = title_prefix_tags(title)
    seen = set(picked)
    for source_tag in source_tags:
        name = clean_text(source_tag.get("name") or "").strip()
        try:
            item_count = int(source_tag.get("item_count") or 0)
        except (TypeError, ValueError):
            item_count = 0
        if not name or name in seen or not keep_caption_tag(name, item_count):
            continue
        picked.append(name)
        seen.add(name)
        if len(picked) >= 3:
            break
    return picked[:3]


def title_without_prefix(title: str) -> str:
    cleaned = clean_text(title)
    _, remainder = split_prefixes(cleaned)
    return remainder or cleaned


def clean_caption_title(title: str) -> str:
    body = title_without_prefix(title)
    for _ in range(3):
        previous = body
        body = TITLE_CODE_SUFFIX_RE.sub("", body).strip()
        body = TITLE_COPY_SUFFIX_RE.sub("", body).strip()
        body = TITLE_CODE_PREFIX_RE.sub("", body).strip()
        body = strip_separators(body)
        if body == previous:
            break
    return body


def title_component(value: str, fallback: str) -> str:
    cleaned = clean_text(value).replace("/", "／").replace("\\", "＼")
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", cleaned).strip(" .")
    return (cleaned or fallback)[:120]


def parse_source_tags(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def clean_title(raw_title: str, source_tags: list[dict[str, Any]]) -> tuple[str, str]:
    cleaned_raw_title = clean_text(raw_title)
    tags = caption_tags(cleaned_raw_title, source_tags)
    cleaned_body = clean_caption_title(cleaned_raw_title)
    if not tags:
        return title_component(cleaned_body, "未命名视频")[:180], ""
    author = title_component(tags[0], "")
    if not cleaned_body:
        return author[:180], author
    body = title_component(cleaned_body, "未命名视频")
    return f"{author}_{body}"[:180], author


def source_command() -> list[str]:
    query = shlex.quote(SOURCE_QUERY)
    remote = f"sqlite3 -json {shlex.quote(SOURCE_DB_PATH)} {query}"
    return [
        "sshpass", "-e", "ssh", "-T", "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15", f"root@{SOURCE_HOST}", remote,
    ]


def export_source_rows() -> list[dict[str, Any]]:
    env = os.environ.copy()
    env["SSHPASS"] = SOURCE_PASSWORD
    result = subprocess.run(source_command(), capture_output=True, text=True, env=env, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"读取 upload-01 catalog 失败：{result.stderr[-1000:]}")
    rows = json.loads(result.stdout)
    if not isinstance(rows, list):
        raise RuntimeError("upload-01 catalog 返回格式无效")
    return rows


def connect_state() -> sqlite3.Connection:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(STATE_DB, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS items (
          post_id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          manifest_url TEXT NOT NULL,
          post_url TEXT NOT NULL DEFAULT '',
          published_at TEXT,
          estimated_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          media_id INTEGER,
          node_id TEXT,
          version TEXT NOT NULL DEFAULT '',
          size_bytes INTEGER,
          duration_seconds REAL,
          last_error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_xnxsz_items_status ON items(status, post_id);
        CREATE INDEX IF NOT EXISTS idx_xnxsz_items_title ON items(title);
        """,
    )
    return connection


def seed_state(connection: sqlite3.Connection, source_rows: list[dict[str, Any]]) -> dict[str, int]:
    normalized_rows: list[dict[str, Any]] = []
    added = 0
    duplicates = 0
    skipped = 0
    for source in source_rows:
        try:
            post_id = int(source["post_id"])
            manifest_url = str(source.get("manifest_url") or "").strip()
            parsed = urlparse(manifest_url)
            if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".meijao123.com"):
                skipped += 1
                continue
            title, author = clean_title(
                str(source.get("title") or ""),
                parse_source_tags(source.get("tag_names_json")),
            )
            if post_id <= 0 or not title:
                skipped += 1
                continue
            normalized_rows.append({
                "post_id": post_id,
                "title": title,
                "author": author,
                "manifest_url": manifest_url,
                "post_url": str(source.get("post_url") or ""),
                "published_at": str(source.get("published_at") or ""),
                "estimated_bytes": max(0, int(source.get("estimated_bytes") or 0)),
            })
        except (KeyError, TypeError, ValueError):
            skipped += 1

    with connection:
        for source in normalized_rows:
            connection.execute(
                """
                UPDATE items
                SET title=?, author=?, manifest_url=?, post_url=?, published_at=?, estimated_bytes=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE post_id=?
                """,
                (
                    source["title"], source["author"], source["manifest_url"], source["post_url"],
                    source["published_at"], source["estimated_bytes"], source["post_id"],
                ),
            )

        seen_titles = {
            str(row[0])
            for row in connection.execute("SELECT title FROM items WHERE status <> 'duplicate'").fetchall()
        }
        for source in normalized_rows:
            status_row = connection.execute("SELECT status FROM items WHERE post_id = ?", (source["post_id"],)).fetchone()
            if status_row:
                continue
            if source["title"] in seen_titles:
                status = "duplicate"
                duplicates += 1
            else:
                status = "pending"
                seen_titles.add(source["title"])
                added += 1
            connection.execute(
                "INSERT INTO items (post_id,title,author,manifest_url,post_url,published_at,estimated_bytes,status) VALUES (?,?,?,?,?,?,?,?)",
                (
                    source["post_id"], source["title"], source["author"], source["manifest_url"],
                    source["post_url"], source["published_at"], source["estimated_bytes"], status,
                ),
            )
    return {"source": len(source_rows), "added": added, "duplicates": duplicates, "skipped": skipped}


def connect_project() -> sqlite3.Connection:
    connection = sqlite3.connect(PROJECT_DB, timeout=60, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=60000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def ensure_line_tags(connection: sqlite3.Connection) -> dict[str, int]:
    tag_ids: dict[str, int] = {}
    for tag_name in LINE_TAG_BY_NODE.values():
        row = connection.execute(
            "SELECT id FROM video_tags WHERE name = ? COLLATE NOCASE",
            (tag_name,),
        ).fetchone()
        if not row:
            sort_order = int(connection.execute(
                "SELECT COALESCE(MAX(sort_order), -10) + 10 FROM video_tags",
            ).fetchone()[0])
            connection.execute(
                "INSERT INTO video_tags (name, slug, description, sort_order) VALUES (?, ?, '', ?)",
                (tag_name, tag_name, sort_order),
            )
            row = connection.execute(
                "SELECT id FROM video_tags WHERE name = ? COLLATE NOCASE",
                (tag_name,),
            ).fetchone()
        if not row:
            raise RuntimeError(f"无法创建视频线路标签：{tag_name}")
        tag_ids[tag_name] = int(row[0])
    connection.commit()
    return tag_ids


def ssh_script(node: Node, script: str, timeout: int = REMOTE_TIMEOUT_SECONDS) -> tuple[str, str]:
    env = os.environ.copy()
    env["SSHPASS"] = node.password
    command = [
        "sshpass", "-e", "ssh", "-T", "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15", f"root@{node.host}", "bash", "-s",
    ]
    result = subprocess.run(command, input=script, capture_output=True, text=True, env=env, timeout=timeout)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "远端命令失败").strip()
        raise RuntimeError(f"{node.id}: {detail[-1200:]}")
    return result.stdout, result.stderr


def free_bytes(node: Node) -> int:
    output, _ = ssh_script(node, f"set -eu\ndf -Pk {shlex.quote(node.root)} | tail -1\n", timeout=30)
    fields = output.strip().split()
    if len(fields) < 4:
        raise RuntimeError(f"{node.id}: df 输出无效")
    return int(fields[3]) * 1024


def source_version(post_id: int) -> str:
    return f"{int(time.time() * 1000)}-{post_id}"


def remux_script(node: Node, media_id: int, version: str, manifest_url: str, cover_key: str) -> str:
    root = shlex.quote(node.root)
    source = shlex.quote(manifest_url)
    final = shlex.quote(f"{node.root}/video/.hls/{media_id}/{version}")
    temporary = shlex.quote(f"{node.root}/video/.hls/{media_id}/.{version}.tmp")
    cover_target = shlex.quote(f"{node.root}/.covers/{cover_key}.jpg")
    cover_temporary = shlex.quote(f"{node.root}/.covers/.{cover_key}.tmp.jpg")
    return f"""set -eu
root={root}
final={final}
temporary={temporary}
source={source}
cover_target={cover_target}
cover_temporary={cover_temporary}
rm -rf -- "$temporary" "$final"
mkdir -p -- "$temporary" "$(dirname "$cover_target")"
cleanup() {{ rm -rf -- "$temporary" "$cover_temporary"; }}
trap cleanup EXIT
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$source" -map 0:v:0 -map 0:a:0? -c:v copy -c:a copy -bsf:a aac_adtstoasc -avoid_negative_ts make_zero -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$temporary/bundle-%04d.m4s" "$temporary/index.m3u8"
test -s "$temporary/index.m3u8"
grep -q '#EXT-X-ENDLIST' "$temporary/index.m3u8"
video_probe=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of csv=p=0:s='|' "$temporary/index.m3u8" | sed -n '/[^[:space:]]/p' | head -n 1)
audio_probe=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$temporary/index.m3u8" 2>/dev/null | sed -n '/[^[:space:]]/p' | head -n 1 || true)
duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$temporary/index.m3u8")
video_codec=$(printf '%s' "$video_probe" | cut -d '|' -f 1)
pixel_format=$(printf '%s' "$video_probe" | cut -d '|' -f 2)
if [ "$video_codec" != h264 ] || {{ [ "$pixel_format" != yuv420p ] && [ "$pixel_format" != yuvj420p ]; }}; then echo 'HLS 成品不是兼容的 H.264 像素格式' >&2; exit 42; fi
if [ -n "$audio_probe" ] && [ "$audio_probe" != aac ]; then echo 'HLS 成品音频不是 AAC' >&2; exit 43; fi
case "$duration" in ''|N/A|*[!0-9.]* ) echo 'HLS 时长无效' >&2; exit 44 ;; esac
size_bytes=$(du -sb "$temporary" | cut -f1)
file_count=$(find "$temporary" -maxdepth 1 -type f | wc -l)
timeout --kill-after=5s 90s ffmpeg -hide_banner -loglevel error -nostdin -y -i "$temporary/index.m3u8" -map 0:v:0 -frames:v 1 -vf 'scale=640:-2:force_original_aspect_ratio=decrease' -q:v 5 "$cover_temporary"
test -s "$cover_temporary"
mv -- "$cover_temporary" "$cover_target"
mkdir -p -- "$(dirname "$final")"
mv -- "$temporary" "$final"
trap - EXIT
printf 'RESULT|%s|%s|%s|%s|%s|%s\n' "$size_bytes" "$duration" "$video_codec" "$pixel_format" "$audio_probe" "$file_count"
"""


def cover_script(node: Node, stored_name: str, cover_key: str, duration: float | None) -> str:
    root = shlex.quote(node.root)
    source = shlex.quote(f"{node.root}/{stored_name}")
    target = shlex.quote(f"{node.root}/.covers/{cover_key}.jpg")
    temporary = shlex.quote(f"{node.root}/.covers/.{cover_key}.tmp.jpg")
    duration_value = f"{float(duration):.6f}" if duration and duration > 0 else "0"
    return f"""set -eu
root={root}
source={source}
target={target}
temporary={temporary}
duration={duration_value}
mkdir -p -- "$(dirname "$target")"
cleanup() {{ rm -f -- "$temporary"; }}
trap cleanup EXIT
test -s "$source"
if [ "$duration" = 0 ]; then
  duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$source")
fi
timeout --kill-after=5s 90s ffmpeg -hide_banner -loglevel error -nostdin -y -i "$source" -map 0:v:0 -frames:v 1 -vf 'scale=640:-2:force_original_aspect_ratio=decrease' -q:v 5 "$temporary"
test -s "$temporary"
mv -- "$temporary" "$target"
trap - EXIT
printf 'COVER|%s\n' "$target"
"""


def cleanup_remote_output(node: Node, media_id: int, version: str, cover_key: str | None = None) -> None:
    target = shlex.quote(f"{node.root}/video/.hls/{media_id}")
    cover = shlex.quote(f"{node.root}/.covers/{cover_key}.jpg") if cover_key else ""
    try:
        command = f"set -eu\nrm -rf -- {target}\n"
        if cover:
            command += f"rm -f -- {cover}\n"
        ssh_script(node, command, timeout=120)
    except Exception:
        pass


def parse_result(output: str) -> tuple[int, float, int]:
    lines = [line.strip() for line in output.splitlines() if line.strip().startswith("RESULT|")]
    if not lines:
        raise RuntimeError("远端未返回 HLS 验证结果")
    fields = lines[-1].split("|")
    if len(fields) != 7:
        raise RuntimeError("远端 HLS 验证结果格式无效")
    size = int(fields[1])
    duration = float(fields[2])
    file_count = int(fields[6])
    if size <= 0 or duration <= 0 or file_count < 3:
        raise RuntimeError("远端 HLS 验证结果为空")
    return size, duration, file_count


def normalize_date(value: str | None) -> str:
    raw = clean_text(value or "")
    if not raw:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class Importer:
    def __init__(self, nodes: list[Node], max_items: int = 0) -> None:
        self.nodes = nodes
        self.max_items = max_items
        self.state = connect_state()
        self.project = connect_project()
        self.db_lock = threading.Lock()
        self.line_tag_ids = ensure_line_tags(self.project)
        self.imported_this_run = 0

    def apply_line_tag(self, media_id: int, node_id: str) -> bool:
        line_name = LINE_TAG_BY_NODE.get(node_id)
        tag_id = self.line_tag_ids.get(line_name or "")
        if not tag_id:
            return False
        line_tag_ids = tuple(self.line_tag_ids.values())
        placeholders = ",".join("?" for _ in line_tag_ids)
        self.project.execute(
            f"DELETE FROM media_asset_tags WHERE media_id=? AND tag_id IN ({placeholders})",
            (media_id, *line_tag_ids),
        )
        self.project.execute(
            "INSERT OR IGNORE INTO media_asset_tags (media_id, tag_id) VALUES (?, ?)",
            (media_id, tag_id),
        )
        return True

    def sync_project_titles(self) -> int:
        with self.db_lock:
            rows = self.state.execute(
                "SELECT media_id,title,author,node_id FROM items WHERE media_id IS NOT NULL",
            ).fetchall()
            updated = 0
            for row in rows:
                media_id = int(row["media_id"])
                title = str(row["title"])
                author = str(row["author"])
                result = self.project.execute(
                    """
                    UPDATE media_assets
                    SET title=?, artist=?, file_name=?, category_id=NULL, updated_at=CURRENT_TIMESTAMP
                    WHERE id=? AND kind='video'
                    """,
                    (title, author, f"{title}.mp4", media_id),
                )
                self.apply_line_tag(media_id, str(row["node_id"] or ""))
                updated += int(result.rowcount > 0)
            self.project.commit()
        return updated

    def sync_project_line_tags(self) -> int:
        with self.db_lock:
            rows = self.project.execute(
                """
                SELECT id,storage_node_id
                FROM media_assets
                WHERE kind='video' AND playback_format='hls' AND playback_status='ready'
                """,
            ).fetchall()
            tagged = 0
            for row in rows:
                tagged += int(self.apply_line_tag(int(row["id"]), str(row["storage_node_id"] or "")))
            self.project.commit()
        return tagged

    def repair_missing_covers(self) -> tuple[int, int]:
        with self.db_lock:
            rows = self.project.execute(
                """
                SELECT id,stored_name,duration_seconds,storage_node_id
                FROM media_assets
                WHERE kind='video' AND playback_format='hls' AND playback_status='ready'
                  AND stored_name LIKE 'video/.hls/%/index.m3u8'
                  AND (custom_cover_key IS NULL OR custom_cover_key='')
                ORDER BY id
                """,
            ).fetchall()
        nodes = {node.id: node for node in self.nodes}
        semaphores = {node.id: threading.Semaphore(NODE_CONCURRENCY) for node in self.nodes}

        def repair(row: sqlite3.Row) -> bool:
            node = nodes.get(str(row["storage_node_id"] or ""))
            if not node:
                raise RuntimeError(f"没有找到媒体节点：{row['storage_node_id']}")
            key = secrets.token_hex(16)
            with semaphores[node.id]:
                ssh_script(
                    node,
                    cover_script(node, str(row["stored_name"]), key, row["duration_seconds"]),
                    timeout=300,
                )
            with self.db_lock:
                result = self.project.execute(
                    """
                    UPDATE media_assets
                    SET custom_cover_key=?, updated_at=CURRENT_TIMESTAMP
                    WHERE id=? AND kind='video' AND (custom_cover_key IS NULL OR custom_cover_key='')
                    """,
                    (key, int(row["id"])),
                )
                self.project.commit()
            return bool(result.rowcount)

        repaired = 0
        failed = 0
        workers = min(max(1, len(rows)), len(self.nodes) * NODE_CONCURRENCY)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(repair, row) for row in rows]
            for future in as_completed(futures):
                try:
                    repaired += int(future.result())
                except Exception as error:
                    failed += 1
                    self.log({"event": "cover_failed", "error": str(error)})
        self.log({"event": "covers_repaired", "requested": len(rows), "repaired": repaired, "failed": failed})
        return repaired, failed

    def log(self, payload: dict[str, Any]) -> None:
        payload = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **payload}
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)

    def write_status(self, latest: dict[str, Any] | None = None) -> None:
        with self.db_lock:
            counts = {
                row["status"]: int(row["count"])
                for row in self.state.execute("SELECT status, COUNT(*) AS count FROM items GROUP BY status").fetchall()
            }
        status = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "counts": counts}
        if latest:
            status["latest"] = latest
        temporary = STATUS_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(STATUS_PATH)

    def recover_processing(self) -> None:
        with self.db_lock:
            rows = self.state.execute("SELECT post_id, media_id FROM items WHERE status='processing'").fetchall()
            for row in rows:
                if row["media_id"]:
                    self.project.execute("DELETE FROM media_assets WHERE id = ? AND kind='video'", (int(row["media_id"]),))
                self.state.execute(
                    "UPDATE items SET status='pending', media_id=NULL, node_id=NULL, version='', last_error='调度器重启后恢复', updated_at=CURRENT_TIMESTAMP WHERE post_id=?",
                    (int(row["post_id"]),),
                )
            self.project.commit()
            self.state.commit()

    def pending_items(self) -> list[sqlite3.Row]:
        with self.db_lock:
            return self.state.execute("SELECT * FROM items WHERE status='pending' ORDER BY post_id DESC LIMIT 300").fetchall()

    def reserve(self, item: sqlite3.Row, node: Node) -> tuple[int, str, str]:
        version = source_version(int(item["post_id"]))
        cover_key = secrets.token_hex(16)
        published_at = normalize_date(item["published_at"])
        with self.db_lock:
            now_ms = int(time.time() * 1000)
            cursor = self.project.execute(
                """
                INSERT INTO media_assets (
                  kind,title,artist,description,file_name,stored_name,mime_type,size_bytes,mtime_ms,
                  duration_seconds,category_id,storage_node_id,thumbnail_version,play_count,download_count,
                  recommend_count,published_at,content_updated_at,new_until,play_soda_price,download_soda_price,
                  playback_format,playback_version,playback_manifest_path,playback_status,playback_error
                ) VALUES ('video',?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,?,?,?,0,1,'mp4','',NULL,'processing','')
                """,
                (
                    item["title"], item["author"], "", f"{item['title']}.mp4",
                    f"video/.hls/pending/{item['post_id']}.m3u8", "video/mp4", 0, now_ms,
                    None, None, node.id, published_at, published_at, None,
                ),
            )
            media_id = int(cursor.lastrowid)
            self.project.execute(
                "UPDATE media_assets SET custom_cover_key=? WHERE id=? AND kind='video'",
                (cover_key, media_id),
            )
            self.apply_line_tag(media_id, node.id)
            self.state.execute(
                "UPDATE items SET status='processing', attempts=attempts+1, media_id=?, node_id=?, version=?, last_error='', updated_at=CURRENT_TIMESTAMP WHERE post_id=?",
                (media_id, node.id, version, int(item["post_id"])),
            )
            self.project.commit()
            self.state.commit()
        return media_id, version, cover_key

    def complete(self, item: sqlite3.Row, media_id: int, version: str, node: Node, size: int, duration: float) -> None:
        manifest = f"video/.hls/{media_id}/{version}/index.m3u8"
        with self.db_lock:
            self.project.execute(
                """
                UPDATE media_assets
                SET stored_name=?, size_bytes=?, mtime_ms=?, duration_seconds=?, playback_format='hls',
                    playback_version=?, playback_manifest_path=?, playback_status='ready', playback_error='',
                    playback_published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND kind='video'
                """,
                (manifest, size, int(time.time() * 1000), duration, version, manifest, media_id),
            )
            self.state.execute(
                "UPDATE items SET status='ready', size_bytes=?, duration_seconds=?, last_error='', updated_at=CURRENT_TIMESTAMP WHERE post_id=?",
                (size, duration, int(item["post_id"])),
            )
            self.project.commit()
            self.state.commit()
        self.imported_this_run += 1
        self.log({"event": "ready", "post_id": int(item["post_id"]), "media_id": media_id, "node": node.id, "title": item["title"], "size_bytes": size, "duration": duration})

    def fail(self, item: sqlite3.Row, media_id: int, node: Node, version: str, cover_key: str, error: str) -> None:
        cleanup_remote_output(node, media_id, version, cover_key)
        retryable = "HLS 成品不是兼容" not in error and "音频不是 AAC" not in error and "HLS 成品不是兼容的 H.264" not in error
        with self.db_lock:
            self.project.execute("DELETE FROM media_assets WHERE id=? AND kind='video'", (media_id,))
            self.state.execute(
                "UPDATE items SET status=?, media_id=NULL, node_id=NULL, version='', last_error=?, updated_at=CURRENT_TIMESTAMP WHERE post_id=?",
                ("pending" if retryable and int(item["attempts"]) < 3 else "failed", error[-1200:], int(item["post_id"])),
            )
            self.project.commit()
            self.state.commit()
        self.log({"event": "failed", "post_id": int(item["post_id"]), "node": node.id, "title": item["title"], "retryable": retryable, "error": error[-500:]})

    def run_item(self, item: sqlite3.Row, node: Node) -> None:
        media_id, version, cover_key = self.reserve(item, node)
        try:
            output, _ = ssh_script(node, remux_script(node, media_id, version, str(item["manifest_url"]), cover_key))
            size, duration, _ = parse_result(output)
            self.complete(item, media_id, version, node, size, duration)
        except Exception as error:
            self.fail(item, media_id, node, version, cover_key, str(error))

    def run_round(self) -> int:
        pending = self.pending_items()
        if not pending:
            self.write_status()
            return 0
        free: dict[str, int] = {}
        for node in self.nodes:
            try:
                free[node.id] = free_bytes(node)
            except Exception as error:
                self.log({"event": "node_unavailable", "node": node.id, "error": str(error)})
        ordered_nodes = sorted((node for node in self.nodes if node.id in free), key=lambda node: free[node.id], reverse=True)
        assignments: list[tuple[sqlite3.Row, Node]] = []
        remaining = list(pending)
        assigned_estimates = {node.id: 0 for node in ordered_nodes}
        for node in ordered_nodes:
            for _ in range(NODE_CONCURRENCY):
                if self.max_items and len(assignments) + self.imported_this_run >= self.max_items:
                    break
                selected_index = None
                selected_estimate = 0
                for index, item in enumerate(remaining):
                    estimate = max(int(item["estimated_bytes"] or 0), DEFAULT_ESTIMATE_BYTES)
                    if free[node.id] - assigned_estimates[node.id] - estimate > SAFETY_BYTES:
                        selected_index = index
                        selected_estimate = estimate
                        break
                if selected_index is None:
                    break
                assignments.append((remaining.pop(selected_index), node))
                assigned_estimates[node.id] += selected_estimate
        if not assignments:
            self.log({"event": "paused", "reason": "所有节点达到安全水位或暂时不可用", "safety_bytes": SAFETY_BYTES, "free_bytes": free})
            self.write_status({"event": "paused", "free_bytes": free})
            return 0
        self.log({
            "event": "dispatch",
            "node_concurrency": NODE_CONCURRENCY,
            "jobs": [{"post_id": int(item["post_id"]), "node": node.id} for item, node in assignments],
        })
        with ThreadPoolExecutor(max_workers=len(assignments)) as executor:
            futures = [executor.submit(self.run_item, item, node) for item, node in assignments]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as error:
                    self.log({"event": "worker_error", "error": str(error)})
        self.write_status()
        return len(assignments)

    def run(self, daemon: bool, once: bool) -> None:
        while True:
            scheduled = self.run_round()
            if once or (self.max_items and self.imported_this_run >= self.max_items):
                return
            if scheduled == 0:
                time.sleep(300 if daemon else 1)
            else:
                time.sleep(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-source", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-items", type=int, default=0)
    parser.add_argument("--repair-covers", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    nodes = node_config()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = STATE_DIR / ("cover-repair.lock" if args.repair_covers else "scheduler.lock")
    with lock_path.open("w", encoding="utf-8") as lock_handle:
        try:
            fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("HLS 调度器已经在运行")
        state = connect_state()
        if args.refresh_source or not state.execute("SELECT 1 FROM items LIMIT 1").fetchone():
            rows = export_source_rows()
            print(json.dumps({"event": "source_export", **seed_state(state, rows)}, ensure_ascii=False), flush=True)
        else:
            print(json.dumps({"event": "source_reuse"}, ensure_ascii=False), flush=True)
        state.close()
        importer = Importer(nodes, max_items=max(0, args.max_items))
        refreshed_titles = importer.sync_project_titles()
        if refreshed_titles:
            importer.log({"event": "titles_refreshed", "count": refreshed_titles})
        tagged = importer.sync_project_line_tags()
        if tagged:
            importer.log({"event": "line_tags_refreshed", "count": tagged})
        if args.repair_covers:
            importer.repair_missing_covers()
            return
        importer.recover_processing()
        importer.run(daemon=args.daemon, once=args.once or not args.daemon)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
