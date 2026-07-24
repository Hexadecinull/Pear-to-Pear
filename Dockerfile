# syntax=docker/dockerfile:1

# --- Stage 1: build the static frontend ---
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: build the server ---
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# --- Stage 3: production runtime, only what's needed to run ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ./client-dist

ENV STATIC_DIR=./client-dist
ENV PORT=8787
EXPOSE 8787

# Node's http server responds 200 on /healthz once listening.
HEALTHCHECK --interval=30s --timeout=3s CMD node -e \
  "fetch('http://localhost:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "dist/index.js"]
