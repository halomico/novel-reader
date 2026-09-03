import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(target(file), "utf8");
const write = (file, value) => {
  fs.mkdirSync(path.dirname(target(file)), { recursive: true });
  fs.writeFileSync(target(file), value.replace(/\r\n?/g, "\n"));
};
function replace(file, pattern, replacement, label) {
  const source = read(file);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${file}: missing ${label || pattern}`);
  write(file, next);
}
function replaceOptional(file, pattern, replacement) {
  const source = read(file);
  const next = source.replace(pattern, replacement);
  if (next !== source) write(file, next);
}
function ensureImport(file, statement) {
  const source = read(file);
  if (source.includes(statement)) return;
  const first = source.match(/^import[^\n]+\n/m);
  if (!first) throw new Error(`${file}: no imports`);
  write(file, source.replace(first[0], `${first[0]}${statement}\n`));
}

// Editor uses the original-channel tag table where available.
{
  const file = "src/features/original-editor/server.ts";
  replaceOptional(
    file,
    /export function listOriginalEditorTags\(\): Array<\{ id: number; name: string \}> \{[\s\S]*?\n\}\n\nexport function getOriginalDraftForAuthor/,
    `export function listOriginalEditorTags(): Array<{ id: number; name: string }> {\n  const db = getDb();\n  const table = tableExists(db, "original_tags") ? "original_tags" : tableExists(db, "tags") ? "tags" : "";\n  if (!table) return [];\n  const columns = tableColumns(db, table);\n  const where = columns.has("visibility")\n    ? "WHERE visibility != 'hidden'"\n    : columns.has("is_visible")\n      ? "WHERE is_visible = 1"\n      : "";\n  return db.prepare(\`SELECT id, name FROM \${table} \${where} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 300\`).all() as Array<{ id: number; name: string }>;\n}\n\nexport function getOriginalDraftForAuthor`,
  );
}

// Clear the launcher key after a successful publication so /original/new starts a fresh draft.
{
  const file = "src/features/original-editor/OriginalComposerShell.tsx";
  replaceOptional(
    file,
    /await deleteLocalOriginalDraft\(initialDraft\.id\);\n      router\.replace/,
    `await deleteLocalOriginalDraft(initialDraft.id);\n      try {\n        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {\n          const key = sessionStorage.key(index);\n          if (key?.startsWith("novel-reader:original-draft-launch:")) sessionStorage.removeItem(key);\n        }\n      } catch {\n        // Session storage may be blocked; a published draft remains editable by its direct URL.\n      }\n      router.replace`,
  );
}

// Always use a valid BodyInit for article assets.
replaceOptional(
  "src/app/original/assets/[id]/route.ts",
  /return new NextResponse\(body, \{/,
  "return new NextResponse(new Uint8Array(body), {",
);

// Visible and idempotent novel engagement for both guests and authenticated readers.
write("src/components/NovelViewTracker.tsx", `"use client";\n\nimport { useEffect, useRef } from "react";\n\nfunction eventId(novelId: number): string {\n  const key = \`novel-reader:novel-view:\${novelId}\`;\n  try {\n    const current = sessionStorage.getItem(key);\n    if (current) return current;\n    const value = \`event_\${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : \`\${Date.now()}_\${Math.random().toString(36).slice(2)}\`}\`;\n    sessionStorage.setItem(key, value);\n    return value;\n  } catch {\n    return \`event_\${Date.now()}_\${Math.random().toString(36).slice(2)}\`;\n  }\n}\n\nfunction recordNovelView(novelId: number): void {\n  void fetch("/api/analytics/novel-view", {\n    method: "POST",\n    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },\n    body: JSON.stringify({ novelId, eventId: eventId(novelId) }),\n    keepalive: true,\n    credentials: "same-origin",\n  }).catch(() => undefined);\n}\n\nexport function NovelViewTracker({ novelId, targetId = "reader-content" }: { novelId: number; targetId?: string }) {\n  const recordedRef = useRef(false);\n  useEffect(() => {\n    const target = document.getElementById(targetId);\n    if (!target) return;\n    let visible = false;\n    let timer = 0;\n    const cancel = () => { if (timer) window.clearTimeout(timer); timer = 0; };\n    const schedule = () => {\n      cancel();\n      if (!visible || recordedRef.current || document.visibilityState !== "visible") return;\n      timer = window.setTimeout(() => {\n        timer = 0;\n        if (!visible || recordedRef.current || document.visibilityState !== "visible") return;\n        recordedRef.current = true;\n        recordNovelView(novelId);\n      }, 1_500);\n    };\n    const observer = new IntersectionObserver(([entry]) => {\n      visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.3);\n      if (visible) schedule(); else cancel();\n    }, { threshold: [0, 0.3, 0.5] });\n    const onVisibility = () => document.visibilityState === "visible" ? schedule() : cancel();\n    observer.observe(target);\n    document.addEventListener("visibilitychange", onVisibility);\n    return () => { cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };\n  }, [novelId, targetId]);\n  return null;\n}\n`);

write("src/app/api/analytics/novel-view/route.ts", `import { type NextRequest, NextResponse } from "next/server";\nimport { recordEngagementEvent, validateEngagementEventId } from "@/core/engagement/record";\nimport { engagementViewerKey } from "@/core/engagement/viewer";\nimport { validateSameOriginMutation } from "@/core/security/origin";\nimport { recordAnalyticsEvent } from "@/lib/analytics";\nimport { getNovelById } from "@/lib/books";\nimport { canAccessNovelLibrary } from "@/lib/config";\nimport { checkContentAccess } from "@/lib/content-access";\nimport { getDb } from "@/lib/db";\nimport { checkRateLimit } from "@/lib/rate-limit";\nimport { getCurrentUserFromRequest } from "@/lib/user-auth";\nimport { recordNovelVisit } from "@/lib/users";\n\nexport const dynamic = "force-dynamic";\nexport const runtime = "nodejs";\n\nexport async function POST(request: NextRequest) {\n  const guard = validateSameOriginMutation(request);\n  if (guard) return guard;\n  let body: { novelId?: unknown; eventId?: unknown };\n  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }\n  const novelId = Number(body.novelId);\n  const eventId = validateEngagementEventId(body.eventId);\n  const user = getCurrentUserFromRequest(request);\n  if (!eventId || !Number.isSafeInteger(novelId) || novelId < 1 || !canAccessNovelLibrary(Boolean(user))) {\n    return NextResponse.json({ error: "not_found" }, { status: 404 });\n  }\n  const book = getNovelById(novelId);\n  if (!book) return NextResponse.json({ error: "not_found" }, { status: 404 });\n  const access = checkContentAccess(request.headers, { scope: "novel", authenticated: Boolean(user), admin: user?.role === "admin", rateLimit: false });\n  if (!access.allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });\n  const viewerKey = engagementViewerKey(request.headers, user?.id);\n  const limit = checkRateLimit({ key: \`novel-view:\${viewerKey}\`, limit: 40, windowMs: 60_000 });\n  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });\n  const db = getDb();\n  db.exec("BEGIN IMMEDIATE");\n  try {\n    const result = recordEngagementEvent(db, { eventId, viewerKey, contentType: "novel", contentId: novelId, action: "detail_view" }, () => {\n      recordNovelVisit(book.id, viewerKey, request.headers.get("user-agent") || "");\n      recordAnalyticsEvent({ headers: request.headers, userId: user?.id ?? null, eventType: "book_view", path: \`/books/\${book.id}\`, referrer: request.headers.get("referer"), novelId: book.id });\n    });\n    db.exec("COMMIT");\n    return NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, { status: result.counted ? 201 : 200, headers: { "Cache-Control": "no-store" } });\n  } catch (error) {\n    db.exec("ROLLBACK");\n    console.error("Failed to record novel engagement", error);\n    return NextResponse.json({ error: "record_failed" }, { status: 500 });\n  }\n}\n`);

{
  const file = "src/components/NovelReaderView.tsx";
  let source = read(file);
  source = source.replace(/import \{ after \} from "next\/server";\n/, "");
  source = source.replace(/import \{ getClientIp \} from "@\/lib\/admin-access";\n/, "");
  source = source.replace(/import \{ recordAnalyticsEvent \} from "@\/lib\/analytics";\n/, "");
  source = source.replace(/import \{ recordNovelVisit, recordReadingHistory \} from "@\/lib\/users";\n/, "");
  source = source.replace(/\n  if \(user\) \{\n    after\(\(\) => \{[\s\S]*?\n    \}\);\n  \}\n/, "\n");
  source = source.replace(/<article className="readerPage hasReaderPreferences">/, '<article className="readerPage hasReaderPreferences" id="reader-content">');
  source = source.replace(/\{!user && readAccess\.allowed \? <NovelViewTracker novelId=\{book\.id\} \/> : null\}/, "{readAccess.allowed ? <NovelViewTracker novelId={book.id} /> : null}");
  write(file, source);
}

// Media details are also recorded only after the primary article is visible.
write("src/components/MediaViewTracker.tsx", `"use client";\n\nimport { useEffect, useRef } from "react";\n\nexport function MediaViewTracker({ mediaId, targetId = "media-detail-primary" }: { mediaId: number; targetId?: string }) {\n  const sent = useRef(false);\n  useEffect(() => {\n    const target = document.getElementById(targetId);\n    if (!target) return;\n    const key = \`novel-reader:media-view:\${mediaId}\`;\n    let id = "";\n    try {\n      id = sessionStorage.getItem(key) || \`event_\${crypto.randomUUID().replace(/-/g, "")}\`;\n      sessionStorage.setItem(key, id);\n    } catch { id = \`event_\${Date.now()}_\${Math.random().toString(36).slice(2)}\`; }\n    let visible = false; let timer = 0;\n    const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };\n    const schedule = () => {\n      cancel();\n      if (!visible || sent.current || document.visibilityState !== "visible") return;\n      timer = window.setTimeout(() => {\n        if (!visible || sent.current || document.visibilityState !== "visible") return;\n        sent.current = true;\n        void fetch("/api/analytics/media-view", { method: "POST", headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" }, body: JSON.stringify({ mediaId, eventId: id }), keepalive: true, credentials: "same-origin" }).catch(() => undefined);\n      }, 1_500);\n    };\n    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .3); visible ? schedule() : cancel(); }, { threshold: [0, .3] });\n    const onVisibility = () => document.visibilityState === "visible" ? schedule() : cancel();\n    observer.observe(target); document.addEventListener("visibilitychange", onVisibility);\n    return () => { cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };\n  }, [mediaId, targetId]);\n  return null;\n}\n`);

write("src/app/api/analytics/media-view/route.ts", `import { type NextRequest, NextResponse } from "next/server";\nimport { recordEngagementEvent, validateEngagementEventId } from "@/core/engagement/record";\nimport { engagementViewerKey } from "@/core/engagement/viewer";\nimport { validateSameOriginMutation } from "@/core/security/origin";\nimport { recordAnalyticsEvent } from "@/lib/analytics";\nimport { checkContentAccess } from "@/lib/content-access";\nimport { getDb } from "@/lib/db";\nimport { getMediaAsset, isMediaKindAccessible } from "@/lib/media";\nimport { checkRateLimit } from "@/lib/rate-limit";\nimport { getCurrentUserFromRequest } from "@/lib/user-auth";\nimport { recordMediaHistory } from "@/lib/users";\n\nexport const dynamic = "force-dynamic";\nexport const runtime = "nodejs";\n\nexport async function POST(request: NextRequest) {\n  const guard = validateSameOriginMutation(request);\n  if (guard) return guard;\n  let body: { mediaId?: unknown; eventId?: unknown };\n  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }\n  const mediaId = Number(body.mediaId);\n  const eventId = validateEngagementEventId(body.eventId);\n  const user = getCurrentUserFromRequest(request);\n  const asset = Number.isSafeInteger(mediaId) && mediaId > 0 ? getMediaAsset(mediaId) : null;\n  if (!eventId || !asset || !isMediaKindAccessible(asset.kind, Boolean(user))) return NextResponse.json({ error: "not_found" }, { status: 404 });\n  const access = checkContentAccess(request.headers, { scope: asset.kind, authenticated: Boolean(user), admin: user?.role === "admin", rateLimit: false });\n  if (!access.allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });\n  const viewerKey = engagementViewerKey(request.headers, user?.id);\n  const limit = checkRateLimit({ key: \`media-view:\${viewerKey}\`, limit: 50, windowMs: 60_000 });\n  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });\n  const db = getDb();\n  db.exec("BEGIN IMMEDIATE");\n  try {\n    const result = recordEngagementEvent(db, { eventId, viewerKey, contentType: asset.kind, contentId: asset.id, action: "detail_view" }, () => {\n      recordAnalyticsEvent({ headers: request.headers, userId: user?.id ?? null, eventType: \`\${asset.kind}_view\`, path: \`/media/\${asset.id}\`, referrer: request.headers.get("referer"), mediaId: asset.id });\n      if (user) recordMediaHistory(user.id, asset);\n    });\n    db.exec("COMMIT");\n    return NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, { status: result.counted ? 201 : 200, headers: { "Cache-Control": "no-store" } });\n  } catch (error) {\n    db.exec("ROLLBACK");\n    console.error("Failed to record media engagement", error);\n    return NextResponse.json({ error: "record_failed" }, { status: 500 });\n  }\n}\n`);

{
  const file = "src/app/media/[id]/page.tsx";
  let source = read(file);
  source = source.replace(/import \{ after \} from "next\/server";\n/, "");
  source = source.replace(/import \{ recordAnalyticsEvent \} from "@\/lib\/analytics";\n/, "");
  source = source.replace(/import \{ recordMediaHistory \} from "@\/lib\/users";\n/, "");
  if (!source.includes('import { MediaViewTracker }')) {
    const first = source.match(/^import[^\n]+\n/m);
    source = source.replace(first[0], `${first[0]}import { MediaViewTracker } from "@/components/MediaViewTracker";\n`);
  }
  source = source.replace(/\n  after\(\(\) => \{[\s\S]*?\n  \}\);\n/, "\n");
  source = source.replace(/<article className=\{`mediaDetail is-\$\{asset\.kind\}`\}>/, '<article className={`mediaDetail is-${asset.kind}`} id="media-detail-primary">\n        <MediaViewTracker mediaId={asset.id} />');
  write(file, source);
}

// Small route-local reliability boundaries for the editor.
write("src/app/original/write/[draftId]/loading.tsx", `export default function LoadingOriginalComposer() {\n  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }} role="status">正在载入写作空间…</main>;\n}\n`);
write("src/app/original/write/[draftId]/error.tsx", `"use client";\n\nexport default function OriginalComposerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {\n  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}><section><h1>写作空间暂时无法打开</h1><p>本机恢复副本不会因本页面错误被主动删除。</p><button type="button" onClick={reset}>重新载入</button></section></main>;\n}\n`);

console.log("Final integration applied.");
