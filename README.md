# Novel Reader

A clean self-hosted web reader for local `.txt` novel libraries. It is built with Next.js and SQLite, with a lightweight admin panel for managing books, search indexes, site settings, and users.

## Features

- Local `.txt` novel library scanning
- Fast title search and flexible full-text search syntax
- Separate content index database for easier size control
- Reader-friendly UI with light, dark, standard, and minimal modes
- Admin dashboard for books, indexes, settings, and users
- User accounts, avatars, reading history, and per-user search limits
- Docker-friendly deployment with persistent data volumes

## Tech Stack

- Next.js
- React
- TypeScript
- SQLite
- Node.js

## Quick Start

```bash
npm install
cp .env.example .env
npm run scan:books
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/admin
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm run scan:books
npm run dev
```

## Library Setup

Put novel files in the configured library directory:

```text
library/books/
```

Then scan the library:

```bash
npm run scan:books
```

Runtime data such as novels, databases, uploaded avatars, logs, and local environment files should not be committed.

## Environment

Copy `.env.example` to `.env` and set the required values:

```env
ADMIN_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password
ADMIN_SESSION_SECRET=change_this_to_a_long_random_secret
```

Use a strong random value for `ADMIN_SESSION_SECRET`, for example:

```bash
openssl rand -hex 32
```

## Scripts

```bash
npm run dev                 # Start the development server
npm run build               # Build for production
npm run start               # Start the production server
npm run scan:books          # Scan the local novel library
npm run index:content       # Build configured content indexes
npm run compact:index       # Inspect or compact the content index database
npm test                    # Run the test suite
```

## Deployment Notes

- Keep `.env`, `data/`, `library/`, and uploaded assets outside Git.
- Back up the SQLite databases before migrations or cleanup operations.
- If running behind a reverse proxy, forward the real client IP headers correctly.
- Use Docker volumes or host-mounted directories for persistent data.

## License

This project is licensed under the ISC License. See [LICENSE](LICENSE) for details.
