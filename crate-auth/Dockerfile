# crate-auth: mycelium OAuth front door + session minter.
# Zero runtime dependencies (uses only Node 20 built-ins: http + crypto).
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Copy manifest first for layer caching. There are no production deps to
# install, but this keeps the build deterministic if deps are added later.
COPY package.json ./
COPY src ./src

EXPOSE 9090

# Run as the built-in non-root user shipped with the node image.
USER node

CMD ["node", "src/server.js"]
