# Single-stage Node 24 image. Builder + runtime in one — keeps things simple
# and the final image is fine for Railway and Cloud Run.
FROM node:24-slim

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for Node 24 / linux-x64; the build
# tools below are a fallback for when a prebuild is missing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm via corepack (bundled with Node).
RUN corepack enable && corepack prepare pnpm@11 --activate

# Install dependencies first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build.
COPY . .
RUN pnpm run build

# Bake the OSM data into ./data/zurich.db so containers start with data rather
# than seeding from Overpass on first request (Cloud Run instances have no
# persistent disk, so every cold start would otherwise re-seed).
RUN pnpm run seed

ENV NODE_ENV=production
ENV PORT=3000
# Opening hours, "open now" and the time labels are evaluated in the process's
# local timezone. Cloud Run defaults to UTC, which made server-rendered pages
# disagree with the browser by 1–2 hours.
ENV TZ=Europe/Zurich
# Bump max HTTP header size (default 16KB). Railway's edge appends many
# proxy/security headers; any internal self-fetch through the proxy can
# exceed undici's default cap and surface as UND_ERR_HEADERS_OVERFLOW.
ENV NODE_OPTIONS="--max-http-header-size=65536"
EXPOSE 3000

CMD ["pnpm", "run", "start"]
