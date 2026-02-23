# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: Builder - Install all dependencies and prepare deployment
###############################################################################
FROM node:25-bookworm-slim AS builder

WORKDIR /app

# Install pnpm via npm (corepack not available in slim image)
RUN npm install -g pnpm

# Copy lockfile + package manifests first for better caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy source files (respecting .dockerignore)
COPY src/api/geolocation/ ./src/api/geolocation/
COPY src/db.ts ./src/db.ts
COPY src/worker/listener.ts ./src/worker/listener.ts
COPY src/ha-connector/ ./src/ha-connector/
COPY tsconfig.json ./
COPY tsconfig.build.json ./

###############################################################################
# Stage 2: Production dependencies - Install only production deps
###############################################################################
FROM node:25-bookworm-slim AS deps

WORKDIR /app

# Install pnpm via npm
RUN npm install -g pnpm

# Copy lockfile + package manifests
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

###############################################################################
# Stage 3: Runtime - Production image with minimal footprint
###############################################################################
FROM node:25-bookworm-slim AS runtime

# OCI Image Labels (build args)
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.title="openclaw-ha-connector" \
      org.opencontainers.image.description="OpenClaw Projects HA Connector" \
      org.opencontainers.image.source="https://github.com/troykelly/openclaw-projects" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="Troy Kelly" \
      org.opencontainers.image.licenses="MIT"

# Install wget for healthcheck (consistent with worker container pattern)
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=deps /app/package.json ./

# Copy source files (geolocation API, db, worker listener, ha-connector)
COPY --from=builder /app/src/api/geolocation/ ./src/api/geolocation/
COPY --from=builder /app/src/db.ts ./src/db.ts
COPY --from=builder /app/src/worker/listener.ts ./src/worker/listener.ts
COPY --from=builder /app/src/ha-connector/ ./src/ha-connector/

# Set environment variables
ENV NODE_ENV=production
ENV HA_CONNECTOR_HEALTH_PORT=9001

# Expose health port
EXPOSE 9001

# Switch to non-root user (node user exists in node:25-bookworm-slim with UID 1000)
USER node

# Use Node 25's native TypeScript support
CMD ["node", "--experimental-transform-types", "--experimental-detect-module", "src/ha-connector/run.ts"]
