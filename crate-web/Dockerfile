# crate-web: the audio-reactive 3D room (React Three Fiber + glTF), served by
# nginx as the site root. Build context is the REPOSITORY ROOT. Build with:
#   docker build -f crate-web/Dockerfile -t ghcr.io/midineutron/crate .
#
# Auth is handled upstream by Traefik forwardAuth -> crate-auth; this image is
# a dumb static server. The catalog (manifest.json, audio/, artwork/) is NOT
# baked in — it is mounted read-only at /catalog from the NFS PV at runtime.
#
# The room streams the catalog same-origin (/manifest.json, /audio/*), so no
# CORS setup is needed for the Web Audio analyser.

# ---- Stage 1: build the room (Vite -> dist/, base '/') ----
FROM node:20 AS build
WORKDIR /build

COPY room ./room
RUN cd room && npm ci && npm run build

# ---- Stage 2: serve with nginx (non-root, listens on :8080) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# App shell (the room). The catalog comes from the runtime NFS mount at /catalog.
COPY --from=build /build/room/dist /usr/share/nginx/html

# Site config (listen :8080; catalog served from /catalog).
COPY crate-web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# Base image already defines a non-root USER (101) and runs:
#   nginx -g 'daemon off;'
