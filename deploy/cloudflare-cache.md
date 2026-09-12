# Cloudflare cache configuration

The origin is the single allow-list for shared caching: only responses that carry
`Cloudflare-CDN-Cache-Control` may be stored at the edge. Cloudflare needs rules
that make those responses eligible and keep personalised requests out of the
shared cache.

## Origin header contract

| Response | Browser `Cache-Control` | Edge `Cloudflare-CDN-Cache-Control` |
| --- | --- | --- |
| `/_next/static/*` | `public, max-age=31536000, immutable` (Next.js) | — (browser header applies) |
| Guest HTML documents (`Accept: text/html`): `/`, `/tags`, `/original/tags`, `/announcements`, `/announcements/{id}` (no query); `/novels`, `/novels/recent`, `/original`, `/original/tags/{slug}`, `/original/author/{id}`, `/tags/{slug}` (only `?page=`) | `private, max-age=0, must-revalidate` | `public, max-age=60, stale-while-revalidate=300, stale-if-error=86400` |
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

## When the origin is saturated

Middleware refuses new work while one instance is saturated, instead of letting
requests queue until they fail with 500. It watches two signals: event-loop delay
(rendering has used up the CPU) and requests waiting for a PostgreSQL connection.

| Level | Trigger (defaults) | Refused |
| --- | --- | --- |
| busy | event loop ≥ 100 ms, or ≥ `PG_WEB_POOL_SIZE` queries waiting | view and search analytics beacons |
| overloaded | event loop ≥ 250 ms, or ≥ 4 × `PG_WEB_POOL_SIZE` waiting | everything except `/admin`, health and readiness checks |

- A document the edge may cache is refused with `503` and `Retry-After`, so Cloudflare
  answers with its stale copy (`stale-if-error`) and guests keep reading.
- Everything else gets `429` and `Retry-After`: a JSON body for `/api/*`, and a short
  page that retries on its own for documents.
- Refusals carry `no-store` for browsers and the edge. A level holds for 3 seconds once
  raised. The level and refusal counts are in the private `/api/ready` response
  (`loadShedding`); thresholds are in `.env.example` (`LOAD_SHED_*`).

In-site navigations and prefetches are never edge-cached (see the table), so each one
reaches the origin. Links therefore prefetch only on intent, within a per-tab budget
(one prefetch per URL a minute, at most four speculative ones per ten seconds, none on
touch), and a tab stops prefetching for a minute after it sees a 429 or 503.

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
