# Dockerfile — PageDrop host service
FROM node:20-alpine

WORKDIR /app

# Install deps against the lockfile first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App source (no build step; run via tsx like the MCP server).
COPY tsconfig.json ./
COPY src ./src

# Non-root user + writable data dir.
RUN addgroup -S pagedrop && adduser -S pagedrop -G pagedrop \
    && mkdir -p /data && chown pagedrop:pagedrop /data
USER pagedrop

ENV PAGEDROP_HOST_DATA_DIR=/data \
    PAGEDROP_HOST_VIEW_PORT=8080 \
    PAGEDROP_HOST_API_PORT=8081
EXPOSE 8080 8081
VOLUME ["/data"]

CMD ["npx", "tsx", "src/host/main.ts"]
