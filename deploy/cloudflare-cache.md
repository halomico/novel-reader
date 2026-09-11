# Cloudflare cache configuration

The origin is the single allow-list for shared caching: only responses that carry
`Cloudflare-CDN-Cache-Control` may be stored at the edge. Cloudflare needs rules
that make those responses eligible and keep personalised requests out of the
shared cache.

## Origin header contract

| Response | Browser `Cache-Control` | Edge `Cloudflare-CDN-Cache-Control` |
| --- | --- | --- |
| `/_next/static/*` | `public, max-age=31536000, immutable` (Next.js) | — (browser header applies) |
| Guest HTML documents (`Accept: text/html`): `/`, `/novels`, `/original`, `/tags`, `/tags/{slug}` (only `?page=` allowed) | `private, max-age=0, must-revalidate` | `public, max-age=60, stale-while-revalidate=300, stale-if-error=86400` |
| Guest reader HTML: `/books/{id}`, `/books/{id}/chapters/{id}` while the library is public; `/original/{slug}` without a query | `private, max-age=0, must-revalidate` | `public, max-age=300, stale-while-revalidate=300, stale-if-error=86400` |
| HTML while site-wide access rules are enabled; everything except `/` while novel rules or rate policies are enabled | Next.js default (no store) | not set — IP/country/rate rules run at the origin |
| Documents with a session or layout-preference cookie | Next.js default (no store) | `no-store` |
| RSC payloads and prefetches (`?_rsc=`, `Accept: */*`), server actions, `/api/*` | `private` / `no-store` | not set — Next.js strips flight headers before middleware, so the origin keys on `Accept` |
| `/default-avatars/*`, `/avatar-widgets/*` | `public, max-age=86400, stale-while-revalidate=604800` | `public, max-age=604800, stale-while-revalidate=86400` |
| Media, HLS, thumbnails, covers, site icons | route specific, see `src/lib/media-*.ts` | route specific, see `Caddyfile.media.example` |

Browsers never keep shared HTML. Back/forward and in-app navigation are served by
the Next.js router cache (`staleTimes` in `next.config.ts`), so a guest who signs
in never sees a stale anonymous page, and mutations purge that cache immediately.

## Cache Rules

Cloudflare evaluates Cache Rules in order and later matches override earlier ones,
so keep the bypass rule last.

1. **Static assets** — `starts_with(http.request.uri.path, "/_next/static/")`
   → Eligible for cache; Edge TTL and Browser TTL: respect origin.
2. **HTML and public assets** — `http.host eq "<your host>"`
   → Eligible for cache; Edge TTL: *Use cache-control header if present, bypass
   cache if not*; Browser TTL: *Respect origin*; Cache key: include the full query
   string. Responses without an edge directive (`private, no-store`) stay uncached.
3. **Bypass personalised requests** (last):

   ```text
   (http.cookie contains "novel_user_session")
   or (http.cookie contains "novel-locale")
   or (http.cookie contains "novel-catalog-search")
   or starts_with(http.request.uri.path, "/admin")
   or starts_with(http.request.uri.path, "/api/")
   or (http.request.uri.query contains "_rsc=")
   ```

   → Bypass cache. The edge ignores `Vary`, so without this rule a signed-in reader
   could receive the anonymous copy of `/novels`.

Media and HLS delivery rules are described in `Caddyfile.media.example`.

Guests without a locale cookie are redirected to `/zh-hant` by `Accept-Language`
and country only when the request reaches the origin. If that first-visit redirect
must also apply to edge hits, add
`any(http.request.accepted_languages[*] in {"zh-TW" "zh-HK" "zh-MO" "zh-Hant"})`
to the bypass rule.

## Freshness and purging

Edge copies can trail the origin by at most `max-age + stale-while-revalidate`:
about 6 minutes for listing pages and 10 minutes for reader pages. After bulk
imports, access-rule changes or site-setting changes that must be visible at once,
purge the affected URLs (`/`, `/novels`, `/tags`, `/books/{id}`) or purge everything.

## Verification

```bash
curl -sI https://<your host>/novels | grep -iE 'cf-cache-status|cache-control'
```

The first guest request reports `MISS`, the next `HIT`; the same request with a
`novel_user_session` cookie reports `BYPASS` or `DYNAMIC`.
