FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS source
WORKDIR /app
# Explicit copies complement the default-deny context. No host configuration,
# uploads, database, backup, deployment directory or prebuilt .next is copied.
COPY package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts ./
COPY src ./src
COPY migrations/postgres ./migrations/postgres
COPY scripts/build-maintenance.mjs \
  scripts/audit-runtime-dependencies.mjs \
  scripts/sanitize-standalone.mjs \
  ./scripts/
COPY scripts/scan-books.ts \
  scripts/reindex-postgres-content.ts \
  scripts/reindex-postgres-search-text.ts \
  scripts/reindex-postgres-originals.ts \
  scripts/optimize-media.ts \
  scripts/media-node.ts \
  scripts/postgres-content-worker.ts \
  scripts/db-migrate-postgres.ts \
  scripts/db-verify-postgres.ts \
  scripts/init-postgres.ts \
  ./scripts/
COPY public/favicon.ico ./public/favicon.ico
COPY public/default-avatars ./public/default-avatars
COPY public/avatar-widgets ./public/avatar-widgets
COPY LICENSE ./
# Repository contract tests inspect these; neither is copied to the runner.
COPY Dockerfile .dockerignore docker-compose.yml ./

FROM source AS verify
RUN npm audit --omit=dev --audit-level=high
RUN npm run check:runtime
RUN npm test

FROM source AS builder
ARG GIT_SHA=development
ARG BUILD_TIME=development
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_BUILD_TIME=$BUILD_TIME
# Force verification while isolating test-created files in the verify stage.
COPY --from=verify /app/package.json ./package.json
RUN npm run build
RUN node scripts/build-maintenance.mjs

FROM node:24-bookworm-slim AS runner
ARG GIT_SHA=development
ARG BUILD_TIME=development
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_BUILD_TIME=$BUILD_TIME
ENV APP_VERSION=2.0.0
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NOVEL_LIBRARY_DIR=/app/library/books
ENV MEDIA_DIR=/app/data/media

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public/favicon.ico ./public/favicon.ico
COPY --from=builder /app/public/default-avatars ./public/default-avatars
COPY --from=builder /app/public/avatar-widgets ./public/avatar-widgets
COPY --from=builder /app/maintenance ./maintenance
COPY --from=builder /app/migrations/postgres ./migrations/postgres
COPY --from=builder /app/maintenance/package.json ./package.json
COPY --from=builder /app/LICENSE ./

RUN mkdir -p /app/library/books /app/data/media /app/public/avatars \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
