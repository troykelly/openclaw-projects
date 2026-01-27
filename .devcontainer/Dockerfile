FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git \
    postgresql-client \
    nodejs npm \
  && rm -rf /var/lib/apt/lists/*

# Put host-mounted CLIs on PATH when present
ENV PATH="/home/clawdbot/.npm-global/bin:/home/clawdbot/.local/share/pnpm:$PATH"
