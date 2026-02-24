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

# Copy source files needed by the tmux worker
COPY src/tmux-worker/ ./src/tmux-worker/
COPY src/db.ts ./src/db.ts
COPY proto/ ./proto/
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
      org.opencontainers.image.title="openclaw-tmux-worker" \
      org.opencontainers.image.description="OpenClaw Projects TMux Session Management Worker" \
      org.opencontainers.image.source="https://github.com/troykelly/openclaw-projects" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="Troy Kelly" \
      org.opencontainers.image.licenses="MIT"

# Install tmux, SSH client/server, and wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    openssh-client \
    openssh-server \
    wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=deps /app/package.json ./

# Copy source files (tmux worker, shared db module, proto definitions)
COPY --from=builder /app/src/tmux-worker/ ./src/tmux-worker/
COPY --from=builder /app/src/db.ts ./src/db.ts
COPY --from=builder /app/proto/ ./proto/

# Set environment variables
ENV NODE_ENV=production
ENV GRPC_PORT=50051
ENV ENROLLMENT_SSH_PORT=2222
ENV TMUX_WORKER_HEALTH_PORT=9002

# Expose gRPC, enrollment SSH, and health ports
EXPOSE 50051 2222 9002

# Switch to non-root user (node user exists in node:25-bookworm-slim with UID 1000)
USER node

# Use Node 25's native TypeScript support
CMD ["node", "--experimental-transform-types", "--experimental-detect-module", "src/tmux-worker/run.ts"]
