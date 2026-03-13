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
COPY src/api/ ./src/api/
COPY src/instrument.ts ./src/instrument.ts
COPY src/db.ts ./src/db.ts
COPY src/email/ ./src/email/
# Terminal routes import credentials + gRPC client from tmux-worker (Epic #1667)
COPY src/tmux-worker/credentials/ ./src/tmux-worker/credentials/
COPY src/tmux-worker/proto-loader.ts ./src/tmux-worker/proto-loader.ts
COPY src/tmux-worker/types.ts ./src/tmux-worker/types.ts
# SSH key generation shared module (Issue #2320)
COPY src/tmux-worker/ssh/keygen.ts ./src/tmux-worker/ssh/keygen.ts
# Gateway metrics import Counter from worker/metrics (Epic #2153)
COPY src/worker/metrics.ts ./src/worker/metrics.ts
# Symphony routes import durable-write helpers (Issue #2261)
COPY src/symphony/ ./src/symphony/
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
      org.opencontainers.image.title="openclaw-api" \
      org.opencontainers.image.description="OpenClaw Projects API Server" \
      org.opencontainers.image.source="https://github.com/troykelly/openclaw-projects" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="Troy Kelly" \
      org.opencontainers.image.licenses="MIT"

# Install curl for healthcheck (Issue #958),
# chromium + shared libs for PDF export via puppeteer-core (Issue #2481),
# pandoc for DOCX/ODF export (Issue #2481)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    openssh-client \
    chromium \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-cjk-extra \
    fonts-noto-color-emoji \
    pandoc \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Puppeteer-core configuration: use system Chromium, skip download (Issue #2481)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=deps /app/package.json ./

# Copy only API source files (no UI, no tests, no docs)
COPY --from=builder /app/src/api/ ./src/api/
# Sentry preload module — loaded via --import before application code (#2000)
COPY --from=builder /app/src/instrument.ts ./src/instrument.ts
COPY --from=builder /app/src/db.ts ./src/db.ts
COPY --from=builder /app/src/email/ ./src/email/
# Terminal routes import credentials + gRPC client from tmux-worker (Epic #1667)
COPY --from=builder /app/src/tmux-worker/credentials/ ./src/tmux-worker/credentials/
COPY --from=builder /app/src/tmux-worker/proto-loader.ts ./src/tmux-worker/proto-loader.ts
COPY --from=builder /app/src/tmux-worker/types.ts ./src/tmux-worker/types.ts
# SSH key generation shared module (Issue #2320)
COPY --from=builder /app/src/tmux-worker/ssh/keygen.ts ./src/tmux-worker/ssh/keygen.ts
# Gateway metrics import Counter from worker/metrics (Epic #2153)
COPY --from=builder /app/src/worker/metrics.ts ./src/worker/metrics.ts
# Symphony routes import durable-write helpers (Issue #2261)
COPY --from=builder /app/src/symphony/ ./src/symphony/
COPY --from=builder /app/proto/ ./proto/

# Set environment variables
ENV NODE_ENV=production
ENV HOST=::
ENV PORT=3000
# Sentry process identifier for error grouping (#2000)
ENV SENTRY_SERVER_NAME=api

# Expose only the API port
EXPOSE 3000

# Switch to non-root user (node user exists in node:25-bookworm-slim with UID 1000)
USER node

# Use Node 25's native TypeScript support with Sentry preload instrumentation (#2000)
CMD ["node", "--experimental-transform-types", "--experimental-detect-module", "--import", "./src/instrument.ts", "src/api/run.ts"]
