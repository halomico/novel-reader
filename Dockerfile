FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm test
RUN npm run build
RUN ./node_modules/.bin/esbuild scripts/*.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node24 \
  --outdir=maintenance
RUN npm pkg set \
  scripts.start="node server.js" \
  scripts.scan:books="node maintenance/scan-books.js" \
  scripts.index:search="node maintenance/build-content-search-index.js" \
  scripts.index:content="node maintenance/index-content.js" \
  scripts.compact:index="node maintenance/compact-content-index.js" \
  scripts.migrate:index-db="node maintenance/migrate-content-index-db.js" \
  scripts.cleanup:legacy-index="node maintenance/cleanup-legacy-index.js" \
  scripts.optimize:media="node maintenance/optimize-media.js"

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NOVEL_LIBRARY_DIR=/app/library/books
ENV DATABASE_PATH=/app/data/novels.db
ENV CONTENT_SEARCH_DB_PATH=/app/data/content-search.db
ENV MEDIA_DIR=/app/data/media

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/maintenance ./maintenance
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/library/books /app/data/media /app/public/avatars
EXPOSE 3000
CMD ["node", "server.js"]
