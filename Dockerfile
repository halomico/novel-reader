FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npm test
RUN npm run build
RUN ./node_modules/.bin/esbuild scripts/*.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node24 \
  --external:sharp \
  --outdir=maintenance
RUN npm pkg set \
  scripts.start="node server.js" \
  scripts.scan:books="node maintenance/scan-books.js" \
  scripts.index:search="node maintenance/build-content-search-index.js" \
  scripts.optimize:media="node maintenance/optimize-media.js"
RUN npm pkg set scripts.media:serve="node maintenance/media-node.js"

FROM node:24-bookworm-slim AS runner
ARG GIT_SHA=development
ARG BUILD_TIME=development
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_BUILD_TIME=$BUILD_TIME
ENV APP_VERSION=2.0.0
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NOVEL_LIBRARY_DIR=/app/library/books
ENV DATABASE_PATH=/app/data/novels.db
ENV CONTENT_SEARCH_INDEX_DIR=/app/data/content-search
ENV MEDIA_DIR=/app/data/media

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/maintenance ./maintenance
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/library/books /app/data/media /app/public/avatars
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
