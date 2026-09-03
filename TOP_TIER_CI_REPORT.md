# Final secure regression validation
typecheck=failure
tests=failure
build=failure
## Typecheck
```text

> novel-reader@2.0.0 typecheck
> tsc --noEmit

next.config.ts(19,14): error TS1005: ',' expected.
next.config.ts(19,22): error TS1005: ',' expected.
src/app/api/media/[id]/favorite/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/favorite/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/favorite/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/favorite/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/favorite/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/favorite/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/favorite/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/grove/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/grove/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/grove/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/grove/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(12,9): error TS1005: ':' expected.
src/app/api/media/[id]/recommendation/route.ts(12,52): error TS1005: ',' expected.
src/app/api/media/[id]/recommendation/route.ts(13,6): error TS1005: ':' expected.
src/app/api/media/[id]/recommendation/route.ts(13,14): error TS1005: ';' expected.
src/app/api/media/[id]/recommendation/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/unlock/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/unlock/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/unlock/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/unlock/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(10,9): error TS1005: ':' expected.
src/app/api/novels/[id]/favorite/route.ts(10,52): error TS1005: ',' expected.
src/app/api/novels/[id]/favorite/route.ts(11,6): error TS1005: ':' expected.
src/app/api/novels/[id]/favorite/route.ts(11,14): error TS1005: ';' expected.
src/app/api/novels/[id]/favorite/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(10,9): error TS1005: ':' expected.
src/app/api/novels/[id]/grove/route.ts(10,52): error TS1005: ',' expected.
src/app/api/novels/[id]/grove/route.ts(11,6): error TS1005: ':' expected.
src/app/api/novels/[id]/grove/route.ts(11,14): error TS1005: ';' expected.
src/app/api/novels/[id]/grove/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(11,9): error TS1005: ':' expected.
src/app/api/novels/[id]/recommendation/route.ts(11,52): error TS1005: ',' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,6): error TS1005: ':' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,14): error TS1005: ';' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(12,9): error TS1005: ':' expected.
src/app/api/novels/[id]/unlock/route.ts(12,52): error TS1005: ',' expected.
src/app/api/novels/[id]/unlock/route.ts(13,6): error TS1005: ':' expected.
src/app/api/novels/[id]/unlock/route.ts(13,14): error TS1005: ';' expected.
src/app/api/novels/[id]/unlock/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(15,9): error TS1005: ':' expected.
src/app/api/original/[id]/engagement/route.ts(15,52): error TS1005: ',' expected.
src/app/api/original/[id]/engagement/route.ts(16,6): error TS1005: ':' expected.
src/app/api/original/[id]/engagement/route.ts(16,14): error TS1005: ';' expected.
src/app/api/original/[id]/engagement/route.ts(16,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(16,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(16,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(17,1): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(12,9): error TS1005: ':' expected.
src/app/api/original/[id]/favorite/route.ts(12,52): error TS1005: ',' expected.
src/app/api/original/[id]/favorite/route.ts(13,6): error TS1005: ':' expected.
src/app/api/original/[id]/favorite/route.ts(13,14): error TS1005: ';' expected.
src/app/api/original/[id]/favorite/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(12,9): error TS1005: ':' expected.
src/app/api/original/[id]/grove/route.ts(12,52): error TS1005: ',' expected.
src/app/api/original/[id]/grove/route.ts(13,6): error TS1005: ':' expected.
src/app/api/original/[id]/grove/route.ts(13,14): error TS1005: ';' expected.
src/app/api/original/[id]/grove/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(10,9): error TS1005: ':' expected.
src/app/api/original/[id]/tip/route.ts(10,52): error TS1005: ',' expected.
src/app/api/original/[id]/tip/route.ts(11,6): error TS1005: ':' expected.
src/app/api/original/[id]/tip/route.ts(11,14): error TS1005: ';' expected.
src/app/api/original/[id]/tip/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(10,9): error TS1005: ':' expected.
src/app/api/original/authors/[id]/block/route.ts(10,52): error TS1005: ',' expected.
src/app/api/original/authors/[id]/block/route.ts(11,6): error TS1005: ':' expected.
src/app/api/original/authors/[id]/block/route.ts(11,14): error TS1005: ';' expected.
src/app/api/original/authors/[id]/block/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(11,73): error TS1128: Declaration or statement expected.
src/lib/content-access.test.ts(9,1): error TS1003: Identifier expected.
src/lib/content-access.test.ts(9,7): error TS1005: ',' expected.
src/lib/content-access.test.ts(9,30): error TS1005: ',' expected.
src/lib/content-access.test.ts(9,39): error TS1005: ',' expected.
src/lib/content-access.test.ts(9,43): error TS1005: ',' expected.
src/lib/content-access.test.ts(9,60): error TS1005: ',' expected.
src/lib/content-access.test.ts(10,8): error TS1005: ',' expected.
src/lib/content-access.test.ts(10,12): error TS1005: ',' expected.
src/lib/content-access.test.ts(10,30): error TS1005: ',' expected.
src/lib/content-access.test.ts(10,32): error TS1003: Identifier expected.
src/lib/content-access.test.ts(10,44): error TS1005: ',' expected.
src/lib/content-access.test.ts(11,5): error TS1005: ',' expected.
src/lib/content-access.test.ts(11,11): error TS1005: ',' expected.
src/lib/content-access.test.ts(23,1): error TS1109: Expression expected.
src/lib/content-access.test.ts(23,3): error TS1434: Unexpected keyword or identifier.
```
## Tests
```text

> novel-reader@2.0.0 test
> node --import tsx --test "src/**/*.test.ts"

✔ keeps enough HLS buffer and tolerates slow cold fragment responses (1.485123ms)
✖ legacy access controls are copied, media scopes expand, and migration is idempotent (9.747724ms)
✔ an unconvertible legacy row rolls back without destroying the source table (2.672968ms)
✔ none mode ignores all forwarding headers (38.121472ms)
✔ signed mode requires a valid shared secret and a single valid IP (1.742291ms)
✔ Cloudflare headers are read only in explicit cloudflare mode (14.019492ms)
✔ same-origin JSON mutation with custom header passes (29.264877ms)
✔ same-site subdomain and missing mutation header are rejected (2.037665ms)
✔ non-JSON mutations require an explicit opt-out (0.923387ms)
✔ serializes one paid gate into isolated public and paid snapshots (3.702371ms)
✔ preserves code and link text without whole-document normalization (0.758134ms)
✔ IP and CIDR rules handle IPv4, IPv6, mapped IPv4 and wildcards (8.817639ms)
✔ network rule normalization rejects malformed values (1.138163ms)
✔ admin client IP is accepted only from the signed proxy header (29.851989ms)
✔ caches aggregate analytics briefly without making realtime visits stale (205.646008ms)
✔ normalizes analytics ranges (0.930157ms)
✔ normalizes realtime analytics filters (0.272571ms)
✔ parses common desktop browser user agents (0.968163ms)
✔ parses mobile user agents (0.253302ms)
✔ filters realtime visits before counting and pagination (236.714685ms)
✔ honors the configured catalog range up to 100 books (1.255956ms)
✔ keeps catalog sorting and access filters on their supported values (0.29951ms)
✔ resolves adjacent novels by the configured time or name order (225.535802ms)
✔ pushes compound title matching into SQLite (5.8658ms)
✔ samples sparse novel IDs uniformly without depending on ID gaps (0.778254ms)
✔ paginates promoted novels before the regular catalog without gaps (0.399557ms)
✔ reuses segmented content until the novel file version changes (40.18897ms)
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

Error: Transform failed with 1 error:
/home/runner/work/novel-reader/novel-reader/src/lib/content-access.test.ts:9:6: ERROR: Expected "as" but found "previousTrustProxyMode"
    at failureErrorWithLog (/home/runner/work/novel-reader/novel-reader/node_modules/esbuild/lib/main.js:1748:15)
    at /home/runner/work/novel-reader/novel-reader/node_modules/esbuild/lib/main.js:1017:50
    at responseCallbacks.<computed> (/home/runner/work/novel-reader/novel-reader/node_modules/esbuild/lib/main.js:884:9)
    at handleIncomingPacket (/home/runner/work/novel-reader/novel-reader/node_modules/esbuild/lib/main.js:939:12)
    at Socket.readFromStdout (/home/runner/work/novel-reader/novel-reader/node_modules/esbuild/lib/main.js:862:7)
    at Socket.emit (node:events:514:28)
    at addChunk (node:internal/streams/readable:567:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:518:3)
    at Readable.push (node:internal/streams/readable:398:5)
    at Pipe.onStreamRead (node:internal/stream_base_commons:189:23) {
  name: 'TransformError'
}

Node.js v24.20.0
✖ src/lib/content-access.test.ts (199.008409ms)
✔ bounds, expires, clones, and invalidates cached content search results (350.366693ms)
✔ uses only current passage-level bigram FTS rows (7.291205ms)
✔ stores and deletes each library index independently (42.193405ms)
✔ publishes full and incremental shard builds atomically (33.264905ms)
✔ builds and incrementally refreshes an independent content search database (30.993527ms)
✔ normalizes same-origin navigation URLs without hashes (1.54524ms)
✔ allows a client-side context return in the same runtime (0.66667ms)
✔ rejects a record created by an earlier document runtime (0.681421ms)
✔ accepts the canonical chapter redirect for a clicked book (0.518372ms)
✔ rejects direct entries, stale records, and unrelated destinations (0.542117ms)
✔ parses SQLite timestamps as UTC (1.911679ms)
✔ parses SQLite timestamps with fractional seconds as UTC (0.251599ms)
✔ keeps ISO timestamps as absolute instants (0.209057ms)
✔ formats SQLite UTC timestamps into a requested local timezone (23.528626ms)
✔ uses a compact month-day date within one year and adds the year only when older (1.629564ms)
✔ formats recent updates with the shared relative-time scale (0.505684ms)
✖ migrates supported application data and discards retired access records (487.470038ms)
✔ default avatar picker stores a full random seed instead of a fixed catalogue (2.042762ms)
✔ generated avatars are stable SVG combinations and remap legacy defaults (1.339158ms)
✔ login avatar assignment fills only an empty avatar (186.6347ms)
✔ toggles and paginates favorites per user (215.21277ms)
✔ toggles and lists video and audio favorites separately (195.800318ms)
✔ toggles, lists, and batch-removes published original favorites (230.514422ms)
✔ parses plain novel filenames (1.02748ms)
✔ ignores numeric prefix before underscore (0.215556ms)
✔ keeps nonmatching numbers as title content (0.126436ms)
✔ detects txt files case-insensitively (0.136531ms)
✔ uses the seed, sprout, and tree visit thresholds (1.171982ms)
✔ counts visits after planting and resets after removal (241.969471ms)
✔ mixes novels, originals, videos, and audio while excluding generic files (234.042511ms)
✔ keeps human verification optional and validates Turnstile server-side (33.678944ms)
✔ keeps simplified URLs canonical and prefixes traditional public pages (2.543718ms)
✔ uses explicit Chinese language preferences before the country hint (0.94599ms)
✔ converts display text and normalizes traditional search input on demand (145.595093ms)
✔ mail stays disabled unless the complete runtime SMTP configuration is present (2.536818ms)
✔ production email verification requires an explicit public site URL (0.785184ms)
✔ market purchase atomically charges currency and snapshots encrypted delivery (238.930961ms)
✔ market products generate unique slugs, retain cover metadata, and soft delete (183.939437ms)
✔ redemption codes store only hashes and currency exchange updates both ledgers atomically (201.329038ms)
✔ registration invitation usage is bounded and raw codes are never persisted (216.075798ms)
✔ market purchases grant typed library entitlements (210.000109ms)
✔ media entitlements resolve folders from stored media paths (233.76191ms)
✔ video soda grants last 24 hours and repeated unlocks are idempotent (203.049511ms)
✔ video downloads use six-hour tickets and count each new session against the daily level limit (196.004963ms)
[media] library sync 10ms: +1 ~0 -0
✔ records media analytics and unified user browse history (437.635035ms)
✔ library sync does not import new files when discover is off (368.155226ms)
✔ formats media duration for cards and lists (0.927092ms)
✔ requires a separate media-node control secret (2.21828ms)
✔ serves a cached thumbnail after the source video is purged (13.897964ms)
[media] library sync 27ms: +0 ~1 -0
✔ uploads directly to the media node while the main app keeps only the index (661.504527ms)
✔ signs media URLs and rejects tampering or expiry (4.388008ms)
✔ keeps public media signatures stable within a cache bucket (0.641583ms)
✔ signs versioned media thumbnails with explicit cache visibility (1.092576ms)
✔ signs immutable custom media covers (2.064284ms)
✔ signs HLS playlist and fragment paths without allowing traversal (1.294653ms)
✔ signs the virtual fragmented MP4 download without exposing the source file (0.849899ms)
✔ signs each asset with its own configured media node (0.922676ms)
✔ does not enable the old delivery-only media-node mode (0.287543ms)
✔ rejects media node URLs with credentials or a path prefix (0.742421ms)
✔ keeps local storage as the default without enabling a mixed delivery mode (2.736962ms)
✔ requires a complete remote control and delivery configuration (2.08857ms)
✔ routes each media kind through an explicit multi-node registry (3.199883ms)
✔ uses one JSON media node for every kind without a route map (0.268885ms)
✔ requires explicit routes when more than one media node is configured (0.299129ms)
✔ text and markdown previews read local content once without exposing unsupported files (269.295869ms)
✔ chooses the one-third point for video thumbnails (1.203753ms)
✔ honors the configured position for the single video thumbnail (0.21793ms)
✔ builds stable thumbnail cache validators (0.202558ms)
✔ only allows edge caching for publicly accessible thumbnails (3.789794ms)
✔ normalizes custom covers to a bounded versioned JPEG (63.936309ms)
[media] library sync 12ms: +0 ~1 -0
[media] library sync 6ms: +1 ~0 -0
[media] library sync 6ms: +0 ~1 -0
[media] library sync 6ms: +0 ~0 -1
✔ uploads media in chunks, records it, and removes the stored file (466.854766ms)
✔ separates public metadata browsing from signed-in media consumption (5.10971ms)
✔ normalizes supported native media files (1.150721ms)
✔ parses standard and suffix media ranges (0.395792ms)
✔ normalizes media sorting and orders folders by name, item count, size, or update time (11.32324ms)
✔ builds natural name keys for numbered media across pagination (0.718827ms)
✔ searches media recursively with multiple terms and exposes matching folders (213.956029ms)
✔ manages video tags and filters tagged videos before pagination (197.411665ms)
✔ tracks media preparation independently from public list requests (195.875588ms)
✔ publishes HLS atomically while a replacement version is prepared (204.836231ms)
✔ detects whether the MP4 moov atom precedes media data (1.777643ms)
✔ skips remuxing an upload that is already faststart (0.876949ms)
✔ supports chapter previews and idempotent permanent soda unlocks (209.05783ms)
✔ limits locked single-file novels to an approximately 30 percent preview (199.985257ms)
✔ reads chapter books in stable order and resolves adjacent chapters (202.273926ms)
✔ uploads single-file novels directly into the selected source (206.212363ms)
✔ stores both default upload modes in the dedicated default directory (222.589005ms)
✔ defaults every library scope to default and crosses libraries only when explicitly requested (223.312679ms)
✔ keeps remembered library cookies user-specific and recent updates cross-library (204.598913ms)
✔ creates, renames, orders and removes an empty managed source (189.285699ms)
✔ creates and manages a chapter novel without relying on a library rescan (199.493579ms)
✔ migrates and stores an optional normalized book description (236.142638ms)
✔ keeps full-text search as the default and excludes book-only sources (6.06937ms)
✔ normalizes percent-encoded original slugs from route segments (2.524941ms)
✔ extracts a stable article outline without treating fenced code as headings (4.757862ms)
✔ inserts editor dividers as one line without compressing existing breaks (0.398816ms)
✔ preserves prose indentation without rewriting Markdown blocks (0.545812ms)
✖ original articles derive access from price and transfer paid unlocks exactly once (229.463292ms)
✔ enforces configurable article, reply, and compact tag rules (205.602328ms)
✔ rejects stale mutations after the original channel is disabled (192.150083ms)
✔ requires an explicit paid divider and charges replies after the level quota (198.650696ms)
✔ supports chronological article navigation, one-soda tips, and author blocks (210.209047ms)
✖ synchronous administrator compatibility hashes remain salted and verifiable (7.06967ms)
✖ normal user passwords use asynchronous scrypt and reject malformed hashes (0.301803ms)
✖ legacy PBKDF2 users remain valid and are marked for upgrade (5.267331ms)
ℹ Error: Test "synchronous administrator compatibility hashes remain salted and verifiable" at src/lib/password.test.ts:2:995 generated asynchronous activity after the test ended. This activity created the error "TypeError: storedHash.startsWith is not a function" and would have caused the test to fail, but instead triggered an unhandledRejection event.
✔ caches only anonymous public catalog documents (1.285309ms)
✔ keeps personalized and behavior-changing pages private (0.411124ms)
✔ does not cache RSC, prefetch, non-document, or mutation requests (0.158353ms)
✔ uses an explicit zero timestamp and resets at the window boundary (2.318447ms)
✔ clears only rate limit buckets matching the requested prefix (0.416151ms)
✔ reader paragraphs keep Chinese paragraph structure and section headings (1.789289ms)
✔ reader drag only advances after an intentional horizontal gesture (0.298659ms)
✔ reader drag exposes adjacent-document boundaries (0.134227ms)
✔ reader page metrics include the moving gap between adjacent pages (0.2178ms)
✔ separates exact reading progress from durable aggregate analytics (417.385377ms)
✔ charges soda once per user and novel without a daily reset (222.897348ms)
✔ charges soda once per user and media asset without a daily reset (216.851278ms)
✔ enforces report roles, validation, daily limits, and status changes (236.506002ms)
✔ accepts video and audio reports while rejecting novel-only reasons (236.837745ms)
✔ accepts original article reports through the shared report pipeline (186.925986ms)
✔ keeps safe frontend return paths and rejects redirects outside the user site (1.34063ms)
✔ records normalized search queries and aggregates hot terms by range (401.865008ms)
✔ single keyword must be 2 to 15 chars (2.799434ms)
✔ space separated terms default to AND (0.525862ms)
✔ OR terms need a required anchor (0.560854ms)
✔ plus marks a required term across OR branches (1.908645ms)
✔ NOT is equivalent to minus (0.349123ms)
✔ multi keyword allows one-char filters but requires a two-char AND anchor (0.260593ms)
✔ operators are case-insensitive and support quoted exclusions (1.776601ms)
✔ quoted phrases are exact AND filters and cannot be content anchors (0.52384ms)
✔ nested operators can contain quoted phrases (0.356604ms)
✔ punctuation is ignored and cannot be searched alone (0.382382ms)
✔ multi keyword effective length is limited to 200 chars (0.401741ms)
✔ title search can match punctuation and quoted operators (0.753557ms)
✔ index search supports one-char contains matching and ignores symbols (0.324887ms)
✔ content search rejects punctuation-only terms before SQL (0.213243ms)
✔ SQL-shaped input is parsed as text, not executable syntax (0.370325ms)
✖ uses the full-text index for mixed encodings and safely includes changed books (466.4051ms)
✖ merges ready library shards and isolates a removed shard (261.913594ms)
✔ updates a novel file, database metadata, and its title (223.735509ms)
✔ SEO URL helpers normalize the public origin and pagination (3.996202ms)
✔ Umami stays disabled unless both safe values are configured (1.258279ms)
✔ Umami recorder uses an explicit safe URL or derives recorder.js when enabled (0.397364ms)
✔ Umami only tracks public routes (0.221415ms)
✔ site icon upload limit is 15 MB (1.058476ms)
✔ detects supported site icon signatures (1.115951ms)
✔ rejects unsupported site icon content (0.220805ms)
✔ atomically replaces an existing settings file (5.616424ms)
✔ normalizes the configured user default palette (2.527414ms)
✔ adds the original channel to legacy home portal settings (1.428119ms)
✔ normalizes per-source search modes without persisting default entries (0.865692ms)
✔ preserves an empty settings preview and normalizes home portal settings (1.436621ms)
✔ separates public metadata browsing from public content consumption (0.260583ms)
✔ clamps the configured reader font size to 8 through 25 (1.590368ms)
✔ normalizes the configured reader line height (1.701271ms)
✔ normalizes palette rotation and random recommendation settings (1.673981ms)
✔ normalizes the reader tag default and catalog promotion order (1.561585ms)
✔ applies disabled, signed-in, and public novel access modes (5.091793ms)
✔ applies the same access contract to the original channel (3.127857ms)
✔ applies disabled, signed-in, and public advanced tag search modes (2.01387ms)
✔ removes retired settings while preserving current values (1.297817ms)
✔ book sitemap pages stay below the per-file URL limit (1.35374ms)
✔ sitemap XML escapes URLs and renders valid optional fields (0.921885ms)
✔ separates public and member announcements and tracks reads (196.752572ms)
✔ keeps station messages private and updates unread state (224.419054ms)
✔ separates entry drawer announcements from the public announcement list (201.983599ms)
✔ rejects station messages longer than 500 characters without truncating them (187.00149ms)
✔ hiding a tag group hides descendants only for that user (203.406691ms)
✔ replaces a user's hidden tags in one validated batch (216.908079ms)
✔ stores grouped tags and lists novels by tag (218.022552ms)
✔ sorts and samples a tag through its compound index (201.866808ms)
✔ deduplicates and stores manual hotwords (205.158175ms)
✔ loads visible tags for a catalog page in one batch (248.208357ms)
✔ keeps child tag visibility within its parent boundary (200.981637ms)
✔ finds novels containing the intersection of selected visible tags (194.038583ms)
✔ telegram stays optional and parses explicit webhook settings (2.829519ms)
✔ binds a user and queues station notifications without blocking station writes (221.735529ms)
✔ keeps a literal replacement character in valid UTF-8 (1.346249ms)
✔ decodes non-UTF-8 Chinese text as GB18030 (40.501376ms)
✔ ships 21 unique local palettes with Default first and Cinnabar available (1.301203ms)
✔ resolves a stable default palette for each configured time bucket (0.387419ms)
✔ normalizes current and legacy reader tag preferences (0.231761ms)
✔ provides 0.8 through 2.5 reader line heights in 0.1 steps (1.047229ms)
✔ keeps reader width and page-turn preferences within the supported lightweight options (0.334862ms)
✔ normalizes the first-paint reader justification preference (0.14288ms)
✔ normalizes Chinese novel paragraphs while preserving a split segment continuation (0.709763ms)
✔ uses a browser catalog-search preference only when it is valid (0.169008ms)
✔ keeps the six measured reader paper themes in one shared preference model (0.363945ms)
✔ clears the selected reader paper when the system appearance changes (0.44852ms)
✔ maps reader papers to the matching global light or dark appearance (0.256878ms)
✔ daily soda draw has a 20-point ceiling and an exact mean of five (1.474187ms)
✔ daily check-in grants soda once per site day (220.85801ms)
✔ daily check-in leaderboard orders active users by today's reward (171.485005ms)
✔ soda transactions paginate newest records first (208.23039ms)
✔ currency record combines soda and cookie transactions before pagination (224.32131ms)
✔ stores seven configurable frontend levels and enforces their permissions (197.635329ms)
✔ keeps legacy level-zero permissions valid while adding download limits (213.040004ms)
✔ free published HLS is segment-cacheable; paid is not (1.473306ms)
✔ resource path rejects traversal and unknown names (0.464813ms)
✔ rewrite uses bucketed public signatures for free remote HLS (3.344115ms)
✔ rewrite keeps private lease-bound local paths for paid HLS (0.603567ms)
✔ free local rewrite omits lease query so responses can be shared (0.583297ms)
✔ reserves one source-sized output for direct HLS packaging (1.32669ms)
✔ repackages one HLS byte-range object into bounded immutable bundles (1.940111ms)
✔ streams byte ranges across the virtual fragmented MP4 file boundary (13.066023ms)
✔ accepts direct fMP4 segment manifests without byte ranges (3.902886ms)
✔ published manifest reads trust publish-time fragment verification (4.798463ms)
✔ rejects an HLS bundle truncated below a declared byte range (4.189087ms)
✔ selects an explicit video playback migration phase (1.288684ms)
✔ video playback leases enforce concurrency, stable clients, capacity, heartbeat, and expiry (151.803504ms)
✔ selects the configured single video transcode profile (1.246342ms)
✔ selects one output bitrate from the source resolution (0.253052ms)
✔ builds one H.264/AAC output without resizing the source (0.842959ms)
✔ copies compatible streams and transcodes only incompatible codecs (0.391666ms)
ℹ tests 242
ℹ suites 0
ℹ pass 233
ℹ fail 9
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13942.265351

✖ failing tests:

test at src/core/db/content-access-migration.test.ts:30:84
✖ legacy access controls are copied, media scopes expand, and migration is idempotent (9.747724ms)
  Error: UNIQUE constraint failed: content_access_rules.id
      at insertRule (/home/runner/work/novel-reader/novel-reader/src/core/db/content-access-migration.ts:255:7)
      at migrateContentAccessSchemaSafe (/home/runner/work/novel-reader/novel-reader/src/core/db/content-access-migration.ts:356:40)
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/core/db/content-access-migration.test.ts:42:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.start (node:internal/test_runner/test:1257:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    code: 'ERR_SQLITE_ERROR',
    errcode: 1555,
    errstr: 'constraint failed'
  }

test at src/lib/content-access.test.ts:1:1
✖ src/lib/content-access.test.ts (199.008409ms)
  'test failed'

test at src/lib/db.test.ts:2:1089
✖ migrates supported application data and discards retired access records (487.470038ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  3 !== 0
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/db.test.ts:228:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 3,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/original.test.ts:5:1942
✖ original articles derive access from price and transfer paid unlocks exactly once (229.463292ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    {
  +   counted: true,
  +   duplicateEvent: false,
      readingHistoryRecorded: false,
      recorded: true
    }
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/original.test.ts:166:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: { recorded: true, counted: true, readingHistoryRecorded: false, duplicateEvent: false },
    expected: { recorded: true, readingHistoryRecorded: false },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at src/lib/password.test.ts:2:995
✖ synchronous administrator compatibility hashes remain salted and verifiable (7.06967ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + Promise {
  +   <rejected> TypeError: storedHash.startsWith is not a function
  +       at verifyPassword (/home/runner/work/novel-reader/novel-reader/src/lib/password.ts:98:18)
  +       at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:10:16)
  +       at Test.runInAsyncScope (node:async_hooks:227:14)
  +       at Test.run (node:internal/test_runner/test:1397:25)
  +       at Test.start (node:internal/test_runner/test:1257:17)
  +       at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17),
  +   Symbol(async_id_symbol): 90,
  +   Symbol(trigger_async_id_symbol): 37
  + }
  - true
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:10:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.start (node:internal/test_runner/test:1257:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Promise],
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/password.test.ts:2:1510
✖ normal user passwords use asynchronous scrypt and reject malformed hashes (0.301803ms)
  TypeError: (0 , import_password.hashPasswordAsync) is not a function
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:15:22)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)

test at src/lib/password.test.ts:2:2166
✖ legacy PBKDF2 users remain valid and are marked for upgrade (5.267331ms)
  TypeError: (0 , import_password.verifyPasswordAsync) is not a function
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:28:22)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7)

test at src/lib/search.test.ts:2:1106
✖ uses the full-text index for mixed encodings and safely includes changed books (466.4051ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
  -   'GB18030 小说',
      'UTF8 小说'
    ]
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/search.test.ts:60:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ 'UTF8 小说' ],
    expected: [ 'GB18030 小说', 'UTF8 小说' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at src/lib/search.test.ts:10:1702
✖ merges ready library shards and isolates a removed shard (261.913594ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      '第一本',
  -   '第二本'
    ]
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/search.test.ts:192:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ '第一本' ],
    expected: [ '第一本', '第二本' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```
## Build
```text

> novel-reader@2.0.0 build
> next build

 ⨯ Failed to load next.config.ts, see more info here https://nextjs.org/docs/messages/next-config-error

> Build error occurred
[Error:   [31mx[0m Expected ',', got '{'
    ,-[19:1]
 [2m16[0m |           {
 [2m17[0m |             key: "Content-Security-Policy-Report-Only",
 [2m18[0m |             value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
 [2m19[0m |           },${process.env.ENABLE_HSTS === "1" ? `
    : [35;1m             ^[0m
 [2m20[0m |           { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },` : ""}
 [2m21[0m |         ],
 [2m22[0m |       },
    `----


Caused by:
    Syntax Error] {
  code: 'GenericFailure'
}
```
