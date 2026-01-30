FROM node:24-bookworm-slim

WORKDIR /app

# Install pnpm via corepack
RUN corepack enable

# Copy lockfile + package manifests first for better caching
COPY package.json pnpm-lock.yaml ./

# Install all deps (tsx/typescript are currently devDependencies)
RUN pnpm install --frozen-lockfile

COPY . ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "api:dev"]
