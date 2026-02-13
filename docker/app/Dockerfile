# -----------------------------------------------------------------------------
# Stage 1: Builder
# Builds the frontend static assets using Vite
# -----------------------------------------------------------------------------
FROM node:25-bookworm-slim AS builder

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm@10

# Copy lockfile + package manifests first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/

# Install all dependencies (including dev deps for build)
RUN pnpm install --frozen-lockfile

# Copy source files needed for build
COPY src/ ./src/
COPY vite.config.ts tsconfig.json tsconfig.build.json ./
COPY components.json ./

# Build the frontend app with base=/ for nginx root-relative asset paths.
# Default Vite base is /static/app/ (for Fastify); Docker/nginx serves from root.
RUN VITE_BASE=/ pnpm run app:build

# Pre-compress assets with gzip and brotli for optimal delivery
# Install brotli tool for compression
RUN apt-get update && apt-get install -y --no-install-recommends brotli \
    && rm -rf /var/lib/apt/lists/*

# Compress JS, CSS, HTML, SVG, JSON files
RUN find /app/src/api/static/app -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.svg" -o -name "*.json" \) \
    -exec gzip -9 -k {} \; \
    -exec brotli -9 -k {} \;

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# Serves static assets via nginx
# -----------------------------------------------------------------------------
FROM nginx:1-alpine AS runtime

# Install envsubst (part of gettext package)
RUN apk add --no-cache gettext

# OCI Labels (values provided via build args)
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.title="openclaw-projects-app" \
      org.opencontainers.image.description="OpenClaw Projects Frontend" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/troykelly/openclaw-projects"

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx config template
COPY docker/app/nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy built static assets from builder (including pre-compressed files)
COPY --from=builder /app/src/api/static/app /usr/share/nginx/html

# Create nginx cache directories with correct permissions
RUN mkdir -p /var/cache/nginx /var/run \
    && chown -R nginx:nginx /var/cache/nginx /var/run /usr/share/nginx/html \
    && chmod -R 755 /var/cache/nginx /var/run /usr/share/nginx/html

# Environment variables for API proxy configuration
# API_HOST: hostname of the API container (default: api)
# API_PORT: port the API listens on (default: 3000)
ENV API_HOST=api
ENV API_PORT=3000

# Use non-root nginx user (UID 101)
USER nginx

EXPOSE 8080

# nginx will process templates at startup (envsubst via docker-entrypoint.sh)
CMD ["nginx", "-g", "daemon off;"]
