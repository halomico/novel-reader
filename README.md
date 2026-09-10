# Novel Reader

An enterprise-grade, self-hosted comprehensive content platform built with **Next.js 15 App Router**, **React 19**, **TypeScript (Strict 0-any)**, and a **PostgreSQL 18** single-database architecture featuring **pg_bigm** Chinese full-text search.

---

## 1. Key Capabilities & Architecture

- **Advanced Novel Reader & Typography**:
  - Auto-detection and streaming decoding of GB18030 and UTF-8 encodings via `iconv-lite`.
  - Sub-pixel horizontal pagination engine for mobile devices (`ReaderPageTurnController.tsx`); 6 paper themes (5 light, 1 dark) and responsive layout for desktop.
  - Granular reading progress tracking (`user_reading_history`), cross-device resumption, bookmarks, and text-to-speech (TTS) integration.
- **High-Performance Full-Text Search (`pg_bigm`)**:
  - Native 2-gram trigram GIN indexing in PostgreSQL 18 for zero-external-dictionary, 100% recall Chinese full-text search.
  - Predictable multi-keyword search: split terms with spaces and require every term, with no operator grammar or expression-planning overhead.
- **Original Content Publishing Studio (Lexical WYSIWYG)**:
  - Meta Lexical rich-text editor with isomorphic Markdown bi-directional conversion.
  - Publication-grade Tab / Shift+Tab indentation (`EditorTabPlugin.tsx`):
    - Paragraph text: Standard Chinese 2-em-space indent (`\u3000\u3000`) and outdent.
    - Code blocks: Standard 2-space indent / outdent.
    - Ordered/Unordered lists: Hierarchical nesting delegation (`INDENT_CONTENT_COMMAND`).
    - Markdown source mode (`<textarea>`): Multi-line selection indentation/outdent preserving selection bounds.
  - A11y Focus Trap (`useFocusTrap`): Cyclic Tab navigation, Escape key dismiss, backdrop click handling, and focus restoration across all dialogs (`PublishDialog`, `ConflictDialog`, etc.).
  - Auto-save (local snapshot ~700ms, server ~2s), revision conflict detection (CAS `409 Conflict`), and dynamic word count boundary enforcement (`articleMinWords`).
- **Streaming Media Center (HLS & fMP4)**:
  - Video HLS CMAF bundling (6-second logical fragments, 16–64 MiB physical bundles) and virtual fragmented MP4 (fMP4) streaming.
  - Multi-node media storage topology (`scripts/media-node.ts`) with anti-leech playback lease tokens and concurrency limits.
  - FFmpeg transcoding pipelines, video poster capture, and ffprobe metadata extraction.
- **Market & Virtual Economy**:
  - Double-entry ledger (`user_currency_transactions`) for Soda (苏打) & Cookie (曲奇) tokens.
  - Daily check-in streaks, lucky soda draws, product ordering, and protected digital asset delivery.
- **7-Tier RBAC & Security Guard**:
  - Fine-grained permissions (Level 0 Guest through Level 6 Core).
  - Session authentication with path-isolated HttpOnly cookies (`/admin` vs `/`).
  - Strict Same-Origin mutation guard with **Loopback Mutual Trust** (`isLoopbackEquivalent` for `localhost` and `127.0.0.1` parity).
  - Optional Cloudflare Turnstile human verification and Telegram bot notifications.
- **Full-Featured Admin Dashboard (`/admin`)**:
  - Centralized operations for novel catalog, media assets, original articles, user permissions, full-text indexes, system settings, and audit logs.
- **Automated Testing Protection Network**:
  - Automated unit and PostgreSQL 18 integration tests covering concurrency, boundaries, transactions, and regressions.

---

## 2. Tech Stack

| Layer | Technology | Specification & Role in Project |
| :--- | :--- | :--- |
| **Runtime** | Node.js 24 LTS | Server-side rendering, streaming I/O, background worker |
| **Framework** | Next.js 15 App Router (`^15.5.21`) | React Server Components (RSC), Server Actions, Route Handlers |
| **UI Library** | React 19 (`^19.0.0`) | Reader chrome, media players, workspace interfaces |
| **Editor** | Meta Lexical (`^0.38.2`) | Rich-text WYSIWYG editor, Tab plugin, focus trap |
| **Language** | TypeScript 5.7 (`^5.7.2`) | 100% strict type checking, zero `any` policy |
| **Database** | PostgreSQL 18 + pg_bigm 1.2 | Single-database architecture with connection pool isolation (`web`, `jobs`, `migrations`) |
| **Styles** | Native CSS / CSS Modules | Core tokens in `styles/core.css`, route-specific stylesheets |
| **Media Engine** | FFmpeg / ffprobe / hls.js | HLS packaging, fMP4 streaming, video posters |
| **Encoding** | iconv-lite / opencc-js | GB18030 / UTF-8 auto-detection, Simplified/Traditional Chinese conversion |
| **Testing** | Node.js Test Runner + tsx | Native unit and PostgreSQL integration tests |
| **Deployment** | Docker & Caddy | Standalone production image, reverse proxy with real client IP preservation |

---

## 3. Directory Layout

```text
├── src/
│   ├── app/                  # Next.js App Router (RSC Pages, Server Actions, Route Handlers)
│   ├── core/                 # Cross-cutting infrastructure
│   │   ├── db/               # Connection pools (webPool, jobsPool, migrationPool) & transactions
│   │   ├── config/           # Validated site settings schema, dynamic cache tag invalidation
│   │   ├── jobs/             # Postgres-backed background task scheduler & leases
│   │   └── security/         # Origin validation, loopback mutual trust, rate limiting
│   ├── domains/              # Domain services & data access repositories
│   │   ├── catalog/          # Book library, sources, chapters, tags, catalog queries
│   │   ├── identity/         # User accounts, sessions, 7-level RBAC, Telegram auth
│   │   ├── reading/          # Text decoding, reading positions, favorites, grove
│   │   ├── originals/        # Original articles, comments, tips, pg_bigm original search
│   │   ├── access/           # Content access rules & rate buckets
│   │   └── analytics/        # Visit logging, search query events, geo stats
│   ├── features/             # High-complexity independent features
│   │   └── original-editor/  # Lexical editor, Tab indentation, focus trap, conflict resolution
│   ├── components/           # Reusable React UI components (reader chrome, modals, breadcrumbs)
│   ├── lib/                  # Shared utilities (useFocusTrap, media protocols, formatters)
│   └── types/                # Global environment and third-party type augmentations
├── migrations/postgres/      # Checksum-verified PostgreSQL schema migrations
├── scripts/                  # Library scanners, index builders, workers, audit scripts
├── library/books/            # Local novel .txt source files (read-only mount)
├── data/                     # Persistent local storage (media, covers, uploads)
└── docs/                     # Comprehensive technical documentation knowledge base
```

---

## 4. Quick Start

### 4.1 Prerequisites
- **Node.js**: `24.0.0` or higher
- **PostgreSQL**: `18.x` with `pg_bigm` extension installed and enabled
- **FFmpeg & ffprobe** *(Optional, required for media video transcoding and thumbnail generation)*

### 4.2 Installation & Setup

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   # Copy template configuration
   cp .env.example .env
   ```
   *Ensure `DATABASE_URL` points to your PostgreSQL 18 instance (e.g., `postgresql://postgres:password@localhost:5432/novel_reader`).*

3. **Run database migrations and bootstrap initial seed**:
   ```bash
   # 1. Apply all schema migrations
   npm run db:pg:migrate

   # 2. Verify schema and pg_bigm extension compatibility
   npm run db:pg:verify

   # 3. Bootstrap default site settings, default library source, and 7 user levels
   npm run db:pg:init
   ```

4. **Place novel `.txt` files and scan the library**:
   Place your `.txt` files into `library/books/`, then run:
   ```bash
   npm run scan:books
   ```

5. **Start the development server**:
   ```bash
   npm run dev
   ```

6. **Access the application**:
   - Main Reader: `http://localhost:3000`
   - Admin Panel: `http://localhost:3000/admin`

---

## 5. NPM Scripts Reference

All commands defined in [`package.json`](package.json):

| Script | Command Line | Description |
| :--- | :--- | :--- |
| **`npm run dev`** | `next dev` | Start Next.js local development server |
| **`npm run build`** | `next build` | Build standalone production Next.js application |
| **`npm run start`** | `next start` | Start built production server |
| **`npm run typecheck`** | `tsc --noEmit` | Strict TypeScript compiler check (0 errors) |
| **`npm test`** | `node --import tsx --test "src/**/*.test.ts"` | Execute all automated unit and integration tests |
| **`npm run check`** | Runtime dependency audit, strict types, tests, and production build | Full CI verification pipeline |
| **`npm run scan:books`** | `tsx scripts/scan-books.ts` | Scan novel `.txt` files and update database catalog |
| **`npm run index:search`** | `tsx scripts/reindex-postgres-content.ts` | Build pg_bigm full-text search index for novel content |
| **`npm run index:originals`**| `tsx scripts/reindex-postgres-originals.ts` | Rebuild full-text index for original articles |
| **`npm run jobs:serve`** | `tsx scripts/postgres-content-worker.ts` | Run persistent background worker process |
| **`npm run db:pg:migrate`** | `tsx scripts/db-migrate-postgres.ts` | Apply checksum-verified PostgreSQL migrations |
| **`npm run db:pg:init`** | `tsx scripts/init-postgres.ts` | Initialize default site settings, source, and user levels |
| **`npm run db:pg:verify`** | `tsx scripts/db-verify-postgres.ts` | Verify PostgreSQL 18 and pg_bigm compatibility |
| **`npm run test:postgres`** | `node --import tsx scripts/test-postgres-integration.ts` | Execute tests against real PostgreSQL 18 test database |
| **`npm run optimize:media`** | `tsx scripts/optimize-media.ts` | Optimize media assets via FFmpeg |
| **`npm run media:serve`** | `tsx scripts/media-node.ts` | Run standalone media storage node server |

---

## 6. Docker Deployment

The repository provides production-ready Docker configurations:

- **`docker-compose.yml`**: Runs the core web service (`app`, bound to `127.0.0.1:${PORT:-3000}`) and background worker (`worker`).
- **`docker-compose.postgres.yml`**: Runs PostgreSQL 18 with `pg_bigm 1.2`.
- **`docker-compose.media.yml`**: Runs the optional standalone media storage node (port 3100).

```bash
# Build and run web service and worker
docker compose up -d

# Check service health
docker compose ps
```

---

## 7. Security & Privacy Standards

- **Zero Secret Commitment**: `.env`, `data/`, `library/`, and uploaded assets are strictly excluded by `.gitignore`.
- **No Direct Public Port Exposure**: The web application listens on `127.0.0.1:3000`. Always route public traffic through a reverse proxy (such as Caddy or Cloudflare) configured to sanitize `X-Forwarded-For` and `CF-Connecting-IP`.
- **Loopback Parity**: The security layer permits equivalent mutation requests between `localhost` and `127.0.0.1` while strictly blocking unauthorized third-party origins.

---

## 8. Technical Documentation Index

For detailed architectural specifications, consult the [`docs/`](docs/) knowledge base:
- [Knowledge Base Index](docs/README.md)
- [Architecture & Code Map](docs/architecture.md)
- [Database Schema & Migrations](docs/database.md)
- [Reader Typography & Lexical Writing Studio](docs/navigation-and-writing.md)
- [Novel Sources, Chapters & Access](docs/novel-sources-chapters-and-access.md)
- [Security & Access Control](docs/security.md)
- [Streaming Media & HLS Pipelines](docs/media.md)
- [Marketplace & Virtual Economy](docs/marketplace.md)
- [Configuration & Environment](docs/configuration.md)
- [Deployment, Upgrades & Rollback](docs/deployment.md)
- [Operations, Worker Queue & Troubleshooting](docs/operations.md)
- [Reading Experience & Performance Baseline](docs/experience-performance.md)
- [Development Standards & Testing](docs/development.md)

---

## License

This project is licensed under the ISC License. See [LICENSE](LICENSE) for details.
