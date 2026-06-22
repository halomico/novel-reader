FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NOVEL_LIBRARY_DIR=/app/library/books
ENV DATABASE_PATH=/app/data/novels.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json ./
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

RUN mkdir -p /app/library/books /app/data
EXPOSE 3000
CMD ["npm", "run", "start"]
