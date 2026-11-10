# syntax=docker/dockerfile:1.7
# GlassExpense — production image (web app + API server).
#   docker build -t glassexpense .
#   docker run -p 3000:3000 -v glassexpense-data:/data --env-file .env glassexpense
# Secrets (.env, Firebase key) and data are NEVER baked into the image: pass them at run time.

ARG NODE_VERSION=22

# ── build: install deps (with the toolchain better-sqlite3 may need), build the web bundle ──────────
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html capacitor.config.ts ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build && npm prune --omit=dev

# ── runtime: no compilers, non-root, only what the server needs ─────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json ./
RUN mkdir -p /data /app/secrets && chown node:node /data /app/secrets
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The entrypoint publishes the OTA bundle for this image's dist/ into /data/updates, then execs the CMD.
ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
