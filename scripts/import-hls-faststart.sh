#!/usr/bin/env bash
set -u -o pipefail

SOURCE_ROOT="${SOURCE_ROOT:-/root/archive/nwxs20/bulk_run/downloads}"
DEST_ROOT="${DEST_ROOT:-/opt/novel-reader/data/media/video/HLS导入}"
STATE_ROOT="${STATE_ROOT:-/root/hls-import-faststart}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-300000000000}"

mkdir -p "$DEST_ROOT" "$STATE_ROOT"
exec 9>"$STATE_ROOT/lock"
if ! flock -n 9; then
  echo "another HLS import is already running" >&2
  exit 1
fi

STATUS_FILE="$STATE_ROOT/status"
CANDIDATES_FILE="$STATE_ROOT/candidates.tsv"
DONE_FILE="$STATE_ROOT/done.list"
FAILED_FILE="$STATE_ROOT/failed.tsv"
LOG_FILE="$STATE_ROOT/import.log"
touch "$DONE_FILE" "$FAILED_FILE"

log() {
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE"
}

free_bytes() {
  df -PB1 "$DEST_ROOT" | awk 'NR == 2 { print $4; exit }'
}

write_status() {
  local state="$1" scanned="$2" candidates="$3" completed="$4" failed="$5" current="$6"
  cat > "$STATUS_FILE" <<EOF
state=$state
scanned=$scanned
candidates=$candidates
completed=$completed
failed=$failed
current=$current
free_bytes=$(free_bytes)
min_free_bytes=$MIN_FREE_BYTES
updated_at=$(date -u +%FT%TZ)
EOF
}

probe_source() {
  local file="$1" v_codec a_codec duration
  v_codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  a_codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  [ "$v_codec" = h264 ] && [ "$a_codec" = aac ] && awk -v d="$duration" 'BEGIN { exit !(d > 0) }'
}

validate_output() {
  local file="$1" v_codec a_codec format duration
  [ -s "$file" ] || return 1
  v_codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  a_codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  format=$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1)
  [ "$v_codec" = h264 ] && [ "$a_codec" = aac ] && [[ ",$format," == *,mp4,* ]] && awk -v d="$duration" 'BEGIN { exit !(d > 0) }'
}

fetch_title() {
  local id="$1" response title
  response=$(curl -fsSL --max-time 15 "https://www.nwxs20.com/api/video/detail?id=$id" 2>/dev/null) || return 1
  title=$(printf '%s' "$response" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("data") or {}).get("title") or "")' 2>/dev/null) || return 1
  printf '%s' "$title" | tr '\r\n' '  ' | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//; s#https?://[^ ]+##g; s/[\\/:*?"<>|]/_/g; s/(女王小说网|nwxs20)//ig; s/[[:space:]]+/ /g; s/^[ ._-]+//; s/[ ._-]+$//'
}

scanned=0
candidates=0
: > "$CANDIDATES_FILE"
write_status scanning "$scanned" "$candidates" 0 0 ""
while IFS= read -r -d '' source; do
  scanned=$((scanned + 1))
  folder=$(basename "$(dirname "$source")")
  id=${folder#video_}
  if probe_source "$source"; then
    title=$(fetch_title "$id" || true)
    if [ -n "$title" ]; then
      destination="$DEST_ROOT/$title.mp4"
      if [ -e "$destination" ] || grep -Fq "$(printf '\t')$destination" "$CANDIDATES_FILE"; then
        printf '%s\tduplicate_title\n' "$source" >> "$FAILED_FILE"
        log "skip_duplicate_title source=$source title=$title"
      else
        printf '%s\t%s\n' "$source" "$destination" >> "$CANDIDATES_FILE"
        candidates=$((candidates + 1))
      fi
    else
      printf '%s\tmissing_title\n' "$source" >> "$FAILED_FILE"
      log "skip_missing_title source=$source"
    fi
  fi
  if (( scanned % 25 == 0 )); then
    write_status scanning "$scanned" "$candidates" 0 0 "$source"
  fi
done < <(find "$SOURCE_ROOT" -mindepth 2 -maxdepth 2 -type f -name '*.ts' -print0)

completed=0
failed=0
total=$(wc -l < "$CANDIDATES_FILE")
write_status importing "$scanned" "$total" "$completed" "$failed" ""
log "scan_complete scanned=$scanned candidates=$total"

while IFS=$'\t' read -r source destination; do
  [ -n "$source" ] || continue
  if grep -Fqx -- "$source" "$DONE_FILE" && validate_output "$destination"; then
    completed=$((completed + 1))
    continue
  fi

  source_size=$(stat -c %s "$source")
  free=$(free_bytes)
  if (( free < MIN_FREE_BYTES + source_size + 536870912 )); then
    write_status paused "$scanned" "$total" "$completed" "$failed" "$source"
    log "paused_low_space source=$source free=$free source_bytes=$source_size"
    exit 0
  fi

  temp="$DEST_ROOT/.$(basename "$destination").remux-$BASHPID.mp4"
  rm -f -- "$temp"
  write_status importing "$scanned" "$total" "$completed" "$failed" "$source"
  log "start source=$source destination=$destination"
  if ffmpeg -hide_banner -loglevel error -nostdin -y -i "$source" \
      -map 0:v:0 -map 0:a:0 -c copy -bsf:a aac_adtstoasc \
      -movflags +faststart "$temp" \
      && validate_output "$temp"; then
    mv -f -- "$temp" "$destination"
    printf '%s\n' "$source" >> "$DONE_FILE"
    completed=$((completed + 1))
    log "done source=$source destination=$destination bytes=$(stat -c %s "$destination")"
  else
    rm -f -- "$temp"
    failed=$((failed + 1))
    printf '%s\t%s\n' "$source" "remux_or_validation_failed" >> "$FAILED_FILE"
    log "failed source=$source"
  fi
done < "$CANDIDATES_FILE"

write_status complete "$scanned" "$total" "$completed" "$failed" ""
log "complete scanned=$scanned candidates=$total completed=$completed failed=$failed"
