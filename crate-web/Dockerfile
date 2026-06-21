# crate-web: multi-stage build of the Crate PWA, served by nginx.
#
# Build context is the REPOSITORY ROOT (the build needs package.json, tools/,
# www/, site.md). Build with:
#   docker build -f crate-web/Dockerfile -t ghcr.io/midineutron/crate .
#
# Auth is handled upstream by Traefik forwardAuth -> crate-auth; this image is
# a dumb static server. The catalog (manifest.json, audio/, artwork/) is NOT
# baked in — it is mounted read-only at /catalog from the NFS PV at runtime.

# ---- Stage 1: build the static site (npm run build -> dist/) ----
FROM node:20 AS build
WORKDIR /build

# Install deps first for layer caching (only re-runs when the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# Sources consumed by the build:
#   tools/obfuscate.js    : www/ -> dist/ (obfuscates JS, copies assets)
#   tools/build-config.js : site.md -> dist/js/site.config.js + injects index.html
COPY tools ./tools
COPY www ./www
COPY site.md ./site.md
RUN npm run build

# Generate dist/version.txt from APP_VERSION. The SPA's version.js fetches
# /version.txt and reloads when it differs from APP_VERSION. Without this file,
# nginx's SPA fallback returns index.html for /version.txt, which never matches
# the version string and sends the app into an infinite reload loop.
RUN node -e "const fs=require('fs');const s=fs.readFileSync('www/js/config.js','utf8');const m=s.match(/APP_VERSION\s*=\s*'([^']+)'/);if(!m){throw new Error('APP_VERSION not found in www/js/config.js')}fs.writeFileSync('dist/version.txt', m[1] + '\n');console.log('wrote dist/version.txt =', m[1])"

# ---- Stage 2: serve with nginx (non-root, listens on :8080) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# App shell only; the catalog comes from the runtime NFS mount at /catalog.
COPY --from=build /build/dist /usr/share/nginx/html

# Site config (listen :8080; catalog served from /catalog).
COPY crate-web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# Base image already defines a non-root USER (101) and runs:
#   nginx -g 'daemon off;'
