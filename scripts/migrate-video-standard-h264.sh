#!/usr/bin/env bash

set -u
set -o pipefail

VIDEO_ROOT="${VIDEO_ROOT:-/app/data/media/video}"
STATE_DIR="${STATE_DIR:-/app/data/media/.video-migration}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-300000000000}"
RESERVE_BYTES="${RESERVE_BYTES:-536870912}"
LOG_FILE="$STATE_DIR/progress.log"
CANDIDATES_FILE="$STATE_DIR/candidates.tsv"
DONE_FILE="$STATE_DIR/done.list"
LOCK_DIR="$STATE_DIR/.lock"

mkdir -p "$STATE_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "another migration process is already running" >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE"
}

available_bytes() {
  df -Pk "$VIDEO_ROOT" | awk 'NR == 2 { printf "%.0f\n", $4 * 1024 }'
}

write_status() {
  local state="$1"
  local current="${2:-}"
  local free_bytes
  free_bytes="$(available_bytes)"
  {
    printf 'state=%s\n' "$state"
    printf 'updated_at=%s\n' "$(timestamp)"
    printf 'current=%s\n' "$current"
    printf 'candidates=%s\n' "$(wc -l < "$CANDIDATES_FILE" 2>/dev/null || echo 0)"
    printf 'completed=%s\n' "$(wc -l < "$DONE_FILE" 2>/dev/null || echo 0)"
    printf 'free_bytes=%s\n' "$free_bytes"
    printf 'min_free_bytes=%s\n' "$MIN_FREE_BYTES"
  } > "$STATE_DIR/status.tmp"
  mv -f "$STATE_DIR/status.tmp" "$STATE_DIR/status"
}

probe_file() {
  local file="$1"
  local video audio format width height bitrate
  video="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,bit_rate -of csv=p=0 "$file" 2>/dev/null | head -n 1)" || return 1
  [ -n "$video" ] || return 1
  IFS=, read -r video_codec width height video_bitrate <<< "$video"
  audio="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1 || true)"
  format="$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1 || true)"
  width="${width:-0}"
  height="${height:-0}"
  video_bitrate="${video_bitrate:-0}"
  case "$video_bitrate" in
    ''|N/A|*[!0-9]*) video_bitrate=0 ;;
  esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$video_codec" "${audio:-none}" "$format" "$width" "$height" "$video_bitrate"
}

target_bitrate() {
  local pixels=$(( $1 * $2 ))
  if [ "$pixels" -le $((640 * 360)) ]; then echo 600; return; fi
  if [ "$pixels" -le $((854 * 480)) ]; then echo 900; return; fi
  if [ "$pixels" -le $((1280 * 720)) ]; then echo 1600; return; fi
  if [ "$pixels" -le $((1920 * 1080)) ]; then echo 2800; return; fi
  echo 4500
}

candidate_score() {
  local codec="$1" audio="$2" format="$3" ext="$4" bitrate="$5" target="$6" score=0
  [ "$codec" = "h264" ] || score=100
  [ "$audio" = "aac" ] || [ "$audio" = "none" ] || score=$((score < 90 ? 90 : score))
  [ "$format" = "mov,mp4,m4a,3gp,3g2,mj2" ] || score=$((score < 80 ? 80 : score))
  [ "$ext" = "mp4" ] || score=$((score < 70 ? 70 : score))
  if [ "$bitrate" -gt 0 ] && [ "$bitrate" -gt $((target * 1200)) ]; then
    score=$((score < 60 ? 60 : score))
  fi
  echo "$score"
}

build_candidates() {
  local tmp="$CANDIDATES_FILE.tmp"
  : > "$tmp"
  write_status scanning
  log "scanning video metadata under $VIDEO_ROOT"
  while IFS= read -r -d '' file; do
    local meta codec audio format width height bitrate target score size ext
    meta="$(probe_file "$file")" || { log "probe_failed $file"; continue; }
    IFS=$'\t' read -r codec audio format width height bitrate <<< "$meta"
    target="$(target_bitrate "$width" "$height")"
    ext="${file##*.}"
    ext="${ext,,}"
    score="$(candidate_score "$codec" "$audio" "$format" "$ext" "$bitrate" "$target")"
    [ "$score" -gt 0 ] || continue
    size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$score" "$size" "$codec" "$audio" "$width" "$height" "$bitrate" "$file" >> "$tmp"
  done < <(find "$VIDEO_ROOT" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) -print0)
  sort -t $'\t' -k1,1nr -k2,2nr "$tmp" > "$CANDIDATES_FILE"
  rm -f "$tmp"
  log "scan_complete candidates=$(wc -l < "$CANDIDATES_FILE")"
}

verify_output() {
  local file="$1" video audio duration size
  size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
  [ "$size" -gt 0 ] || return 1
  video="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1 || true)"
  [ "$video" = "h264" ] || return 1
  audio="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1 || true)"
  [ "$audio" = "aac" ] || [ -z "$audio" ] || return 1
  duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$file" 2>/dev/null | head -n 1 || true)"
  awk -v value="$duration" 'BEGIN { exit !(value > 0) }'
}

transcode_one() {
  local file="$1" width="$2" height="$3" source_size="$4" target tmp pid free required extension
  target="$(target_bitrate "$width" "$height")"
  source_size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
  free="$(available_bytes)"
  required=$((MIN_FREE_BYTES + source_size + RESERVE_BYTES))
  if [ "$free" -lt "$required" ]; then
    write_status paused "$file"
    log "paused free_bytes=$free required_bytes=$required file=$file"
    return 2
  fi

  extension="${file##*.}"
  tmp="$(dirname "$file")/.$(basename "$file").transcode-$$.$extension"
  write_status converting "$file"
  log "convert_start target_kbps=$target file=$file"
  nice -n 10 ffmpeg -hide_banner -loglevel warning -y -i "$file" \
    -map 0:v:0 -map 0:a:0? -map_metadata 0 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    -b:v "${target}k" -maxrate "$(awk -v v="$target" 'BEGIN { printf "%dk", v * 1.1 }')" \
    -bufsize "$((target * 2))k" -c:a aac -b:a 128k -movflags +faststart "$tmp" \
    > "$STATE_DIR/ffmpeg.log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    free="$(available_bytes)"
    if [ "$free" -lt "$MIN_FREE_BYTES" ]; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$tmp"
      write_status paused "$file"
      log "paused_during_conversion free_bytes=$free file=$file"
      return 2
    fi
    sleep 15
  done
  if ! wait "$pid"; then
    rm -f "$tmp"
    log "convert_failed file=$file; see $STATE_DIR/ffmpeg.log"
    return 1
  fi
  if ! verify_output "$tmp"; then
    rm -f "$tmp"
    log "verify_failed file=$file"
    return 1
  fi
  mv -f "$tmp" "$file"
  printf '%s\n' "$file" >> "$DONE_FILE"
  log "convert_done file=$file"
  return 0
}

[ -s "$CANDIDATES_FILE" ] || build_candidates
write_status running
converted=0
failed=0
while IFS=$'\t' read -r score size codec audio width height bitrate file; do
  [ -n "$file" ] || continue
  grep -Fqx -- "$file" "$DONE_FILE" 2>/dev/null && continue
  if transcode_one "$file" "$width" "$height" "$size"; then
    converted=$((converted + 1))
  else
    result=$?
    [ "$result" -eq 2 ] && exit 0
    failed=$((failed + 1))
  fi
  write_status running
done < "$CANDIDATES_FILE"
write_status complete
log "migration_complete converted=$converted failed=$failed"
