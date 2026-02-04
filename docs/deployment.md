# Deployment Guide

This guide covers deploying openclaw-projects using Docker Compose, from simple localhost setups to production deployments with TLS, HTTP/3, and Web Application Firewall protection.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start (Basic Deployment)](#quick-start-basic-deployment)
- [Production Deployment with Traefik](#production-deployment-with-traefik)
- [Environment Variable Reference](#environment-variable-reference)
- [DNS Provider Configuration](#dns-provider-configuration)
- [Running Behind Another Load Balancer](#running-behind-another-load-balancer)
- [Extending Traefik](#extending-traefik)
- [ModSecurity WAF Configuration](#modsecurity-waf-configuration)
- [SeaweedFS Configuration](#seaweedfs-configuration)
- [Backup and Restore](#backup-and-restore)
- [Upgrading Containers](#upgrading-containers)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

openclaw-projects consists of the following components:

```
                                    Production (Traefik)
                                    ====================

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                              Internet                                        │
    └─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                         ┌─────────────────────────┐
                         │      Traefik 3.6        │
                         │  ┌─────────────────┐    │
                         │  │ TLS 1.3 + HTTP/3│    │
                         │  │ ACME DNS-01     │    │
                         │  │ Rate Limiting   │    │
                         │  └─────────────────┘    │
                         └───────────┬─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
         ┌──────────────────┐              ┌──────────────────┐
         │  api.domain.com  │              │   domain.com     │
         └────────┬─────────┘              └────────┬─────────┘
                  │                                 │
                  ▼                                 │
         ┌──────────────────┐                       │
         │   ModSecurity    │                       │
         │   WAF (CRS 4)    │                       │
         │  ┌────────────┐  │                       │
         │  │ OWASP CRS  │  │                       │
         │  │ Paranoia 1 │  │                       │
         │  └────────────┘  │                       │
         └────────┬─────────┘                       │
                  │                                 │
                  ▼                                 ▼
         ┌──────────────────┐              ┌──────────────────┐
         │   API Server     │              │   Frontend App   │
         │   (Fastify)      │              │   (React + Nginx)│
         │   Port: 3001     │              │   Port: 3000     │
         └────────┬─────────┘              └──────────────────┘
                  │
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌──────────────────┐    ┌──────────────────┐
│   PostgreSQL 18  │    │   SeaweedFS      │
│  ┌────────────┐  │    │  (S3-compat)     │
│  │ pgvector   │  │    │   Port: 8333     │
│  │ pg_cron    │  │    │                  │
│  │ TimescaleDB│  │    │                  │
│  └────────────┘  │    │                  │
└──────────────────┘    └──────────────────┘


                                    Basic (localhost)
                                    =================

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         Existing Reverse Proxy                               │
    │                    (nginx, Caddy, cloud LB, etc.)                           │
    └─────────────────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                    ▼                                     ▼
         ┌──────────────────┐                  ┌──────────────────┐
         │   API Server     │                  │   Frontend App   │
         │   Port: 3000     │                  │   Port: 8080     │
         └────────┬─────────┘                  └──────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌──────────────────┐    ┌──────────────────┐
│   PostgreSQL 18  │    │   SeaweedFS      │
└──────────────────┘    └──────────────────┘
```

### Container Images

All images are published to GitHub Container Registry:

| Image | Description |
|-------|-------------|
| `ghcr.io/troykelly/openclaw-projects-db:latest` | PostgreSQL 18 with pgvector, pg_cron, TimescaleDB |
| `ghcr.io/troykelly/openclaw-projects-api:latest` | Node.js/Fastify API server |
| `ghcr.io/troykelly/openclaw-projects-app:latest` | React frontend with Nginx |
| `ghcr.io/troykelly/openclaw-projects-migrate:latest` | Database migration runner |

### Internal Ports

The containers use different internal ports depending on the deployment type:

| Container | Basic Compose | Traefik Compose | Notes |
|-----------|---------------|-----------------|-------|
| **API** | 3000 | 3001 | Traefik uses 3001 to avoid port conflicts with app labels |
| **Frontend (nginx)** | 8080 | 8080 | Consistent across both deployments |
| **PostgreSQL** | 5432 | 5432 | Standard PostgreSQL port |
| **SeaweedFS S3** | 8333 | 8333 | Internal S3-compatible storage |

In the Traefik deployment, the API runs on port 3001 because:
- ModSecurity WAF proxies to `http://api:3001`
- This avoids potential conflicts with Traefik's service discovery

The frontend's nginx automatically proxies `/api/*` requests to the correct API port based on the `API_PORT` environment variable passed by each compose file.

---

## Quick Start (Basic Deployment)

The basic deployment uses `docker-compose.yml` for localhost or behind-proxy deployments without TLS termination.

### Prerequisites

- Docker 24+ and Docker Compose v2
- 2GB RAM minimum (4GB recommended)
- Existing reverse proxy (optional, for production)

### Steps

1. **Clone the repository:**

   ```bash
   git clone https://github.com/troykelly/openclaw-projects.git
   cd openclaw-projects
   ```

2. **Create environment file:**

   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` with required values:**

   ```bash
   # Generate secrets
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   COOKIE_SECRET=$(openssl rand -base64 48)
   S3_SECRET_KEY=$(openssl rand -hex 32)
   AUTH_SECRET=$(openssl rand -base64 32)

   # Update .env file
   sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${POSTGRES_PASSWORD}/" .env
   sed -i "s/^COOKIE_SECRET=.*/COOKIE_SECRET=${COOKIE_SECRET}/" .env
   sed -i "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=${S3_SECRET_KEY}/" .env
   sed -i "s/^OPENCLAW_PROJECTS_AUTH_SECRET=.*/OPENCLAW_PROJECTS_AUTH_SECRET=${AUTH_SECRET}/" .env
   ```

4. **Start the services:**

   ```bash
   docker compose up -d
   ```

5. **Verify deployment:**

   ```bash
   # Check all services are running
   docker compose ps

   # Check API health
   curl http://localhost:3000/health

   # View logs
   docker compose logs -f
   ```

### Service Endpoints (Basic)

| Service | URL | Description |
|---------|-----|-------------|
| API | http://localhost:3000 | REST API |
| Frontend | http://localhost:8080 | Web dashboard |
| SeaweedFS | http://localhost:8333 | S3-compatible storage (internal) |

---

## Production Deployment with Traefik

The production deployment uses `docker-compose.traefik.yml` which includes:

- **Traefik 3.6** reverse proxy with automatic TLS via Let's Encrypt
- **TLS 1.3** only with modern cipher suites
- **HTTP/3 (QUIC)** support for improved performance
- **ModSecurity WAF** with OWASP Core Rule Set
- **Security headers** and rate limiting
- **Container hardening** (read_only, no-new-privileges, cap_drop)

### Prerequisites

- Docker 24+ and Docker Compose v2
- A domain with DNS pointing to your server
- DNS API access for ACME DNS-01 challenges
- Ports 80 and 443 available

### Steps

1. **Clone and prepare:**

   ```bash
   git clone https://github.com/troykelly/openclaw-projects.git
   cd openclaw-projects
   cp .env.example .env
   ```

2. **Configure required environment variables:**

   ```bash
   # Edit .env and set these values:

   # Required secrets (generate random values)
   POSTGRES_PASSWORD=<strong-password>
   COOKIE_SECRET=<base64-string>
   S3_SECRET_KEY=<hex-string>
   OPENCLAW_PROJECTS_AUTH_SECRET=<base64-string>

   # Required for TLS
   DOMAIN=example.com
   ACME_EMAIL=admin@example.com

   # DNS provider (see DNS Provider section below)
   ACME_DNS_PROVIDER=cloudflare
   CF_DNS_API_TOKEN=<your-cloudflare-api-token>
   ```

3. **Start production deployment:**

   ```bash
   docker compose -f docker-compose.traefik.yml up -d
   ```

4. **Verify deployment:**

   ```bash
   # Check services
   docker compose -f docker-compose.traefik.yml ps

   # Check certificate status
   docker compose -f docker-compose.traefik.yml logs traefik | grep -i acme

   # Test HTTPS
   curl https://api.example.com/health

   # Test HTTP/3 (requires curl with HTTP/3 support)
   curl --http3 https://example.com
   ```

### Service Endpoints (Production)

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | https://example.com | Web dashboard (also www.example.com) |
| API | https://api.example.com | REST API (through ModSecurity WAF) |

---

## Environment Variable Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | PostgreSQL password | `openssl rand -base64 32` |
| `COOKIE_SECRET` | Session cookie signing key | `openssl rand -base64 48` |
| `S3_SECRET_KEY` | SeaweedFS S3 secret key | `openssl rand -hex 32` |
| `OPENCLAW_PROJECTS_AUTH_SECRET` | Auth secret for OpenClaw plugin | `openssl rand -base64 32` |

### Required for Production (Traefik)

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain name | `example.com` |
| `ACME_EMAIL` | Let's Encrypt notification email | `admin@example.com` |
| `ACME_DNS_PROVIDER` | DNS provider for ACME | `cloudflare` |

### Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `openclaw` | PostgreSQL username |
| `POSTGRES_DB` | `openclaw` | Database name |

### Service Ports (Basic Deployment)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3000` | External API port |
| `FRONTEND_PORT` | `8080` | External frontend port |
| `SEAWEEDFS_PORT` | `8333` | SeaweedFS S3 port |

### Service Ports (Production/Traefik)

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PORT` | `80` | HTTP port (redirects to HTTPS) |
| `HTTPS_PORT` | `443` | HTTPS port (TCP+UDP for HTTP/3) |

### S3 Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET` | `openclaw` | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region (for AWS compatibility) |
| `S3_ACCESS_KEY` | `openclaw` | S3 access key |
| `S3_FORCE_PATH_STYLE` | `true` | Use path-style URLs (required for SeaweedFS) |

### SeaweedFS

| Variable | Default | Description |
|----------|---------|-------------|
| `SEAWEEDFS_VOLUME_SIZE_LIMIT_MB` | `1000` (basic) / `30000` (production) | Max volume size in MB |

### ModSecurity WAF

| Variable | Default | Description |
|----------|---------|-------------|
| `MODSEC_ENABLED` | `true` | Enable ModSecurity |
| `MODSEC_PARANOIA_LEVEL` | `1` | OWASP CRS paranoia level (1-4) |
| `MODSEC_ANOMALY_INBOUND` | `5` | Inbound anomaly threshold |
| `MODSEC_ANOMALY_OUTBOUND` | `4` | Outbound anomaly threshold |

### Proxy/Load Balancer

| Variable | Default | Description |
|----------|---------|-------------|
| `TRUSTED_IPS` | (empty) | Comma-separated CIDR ranges for trusted proxies |
| `DISABLE_HTTP` | `false` | Disable HTTP listener (use behind another LB) |

### Email (Postmark)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTMARK_TRANSACTIONAL_TOKEN` | (empty) | Postmark API token |
| `POSTMARK_FROM` | (empty) | From address (verified sender) |
| `POSTMARK_REPLY_TO` | (empty) | Reply-to address |
| `POSTMARK_MESSAGE_STREAM` | `outbound` | Message stream name |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_PROJECTS_AUTH_SECRET` | (empty) | Auth secret for OpenClaw plugin requests |
| `OPENCLAW_PROJECTS_AUTH_SECRET_FILE` | (empty) | Load auth secret from file (Docker secrets) |
| `OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND` | (empty) | Load auth secret from command (1Password, etc.) |
| `OPENCLAW_PROJECTS_AUTH_DISABLED` | `false` | Disable auth (NOT RECOMMENDED for production) |

At least one of `OPENCLAW_PROJECTS_AUTH_SECRET`, `_FILE`, or `_COMMAND` must be set for production deployments. Set `OPENCLAW_PROJECTS_AUTH_DISABLED=true` only for local development.

---

## DNS Provider Configuration

The production deployment uses ACME DNS-01 challenges for TLS certificates. This requires API access to your DNS provider.

### Cloudflare

1. **Create an API token:**
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Create a token with `Zone:DNS:Edit` permission for your zone

2. **Configure environment:**

   ```bash
   ACME_DNS_PROVIDER=cloudflare
   CF_DNS_API_TOKEN=your-api-token
   ```

   **Alternative (Global API Key - not recommended):**

   ```bash
   CF_API_KEY=your-global-api-key
   CF_API_EMAIL=your-cloudflare-email
   ```

### AWS Route53

1. **Create an IAM user with Route53 permissions:**

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "route53:GetChange",
           "route53:ChangeResourceRecordSets",
           "route53:ListResourceRecordSets"
         ],
         "Resource": [
           "arn:aws:route53:::hostedzone/YOUR_ZONE_ID",
           "arn:aws:route53:::change/*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": "route53:ListHostedZonesByName",
         "Resource": "*"
       }
     ]
   }
   ```

2. **Configure environment:**

   ```bash
   ACME_DNS_PROVIDER=route53
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   AWS_HOSTED_ZONE_ID=Z1234567890ABC
   AWS_REGION=us-east-1
   ```

### Other DNS Providers

Traefik uses [Lego](https://go-acme.github.io/lego/) for ACME. See the full list of supported DNS providers:

https://go-acme.github.io/lego/dns/

Each provider has specific environment variables. Consult the Lego documentation for your provider.

---

## Running Behind Another Load Balancer

If you're running behind an existing load balancer (AWS ALB, Cloudflare, nginx, etc.), you may need to configure trusted IPs and disable HTTP.

### Configuration

```bash
# Trust forwarded headers from your load balancer
# Use CIDR notation, comma-separated
TRUSTED_IPS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# If your LB handles TLS termination, disable HTTP redirect
DISABLE_HTTP=true

# Use non-standard ports if needed
HTTP_PORT=8080
HTTPS_PORT=8443
```

### Example: Behind AWS ALB

```bash
# ALB health checks come from VPC CIDR
TRUSTED_IPS=10.0.0.0/8

# ALB terminates TLS, internal traffic is HTTP
DISABLE_HTTP=true
```

### Example: Behind Cloudflare

```bash
# Cloudflare IP ranges (keep updated)
# https://www.cloudflare.com/ips/
TRUSTED_IPS=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22
```

---

## Extending Traefik

Traefik can be extended with additional services and routes using two methods:

### Method 1: Docker Labels (Recommended)

Add services with Traefik labels in a `docker-compose.override.yml`:

```yaml
# docker-compose.override.yml
services:
  whoami:
    image: traefik/whoami:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.whoami.rule=Host(`whoami.${DOMAIN}`)"
      - "traefik.http.routers.whoami.entrypoints=websecure"
      - "traefik.http.routers.whoami.tls.certResolver=letsencrypt"
      - "traefik.http.routers.whoami.middlewares=security-headers@file"
      - "traefik.http.services.whoami.loadbalancer.server.port=80"
```

Start with override:

```bash
docker compose -f docker-compose.traefik.yml -f docker-compose.override.yml up -d
```

### Method 2: File Provider (Advanced)

For complex routing or external services, use the file provider:

1. **Create custom config directory:**

   ```bash
   mkdir -p traefik-custom
   ```

2. **Add your route configuration:**

   ```yaml
   # traefik-custom/monitoring.yml
   http:
     routers:
       monitoring:
         rule: "Host(`monitoring.example.com`)"
         service: monitoring-service
         entryPoints:
           - websecure
         middlewares:
           - security-headers@file
         tls:
           certResolver: letsencrypt

     services:
       monitoring-service:
         loadBalancer:
           servers:
             - url: "http://192.168.1.100:9090"
   ```

3. **Mount in docker-compose.override.yml:**

   ```yaml
   services:
     traefik:
       volumes:
         - ./traefik-custom:/etc/traefik/dynamic/custom:ro
   ```

### Available System Middlewares

Reuse these middlewares in your custom routes with the `@file` suffix:

| Middleware | Description |
|------------|-------------|
| `security-headers@file` | HSTS, X-Frame-Options, CSP headers |
| `rate-limit@file` | 100 req/s with burst of 50 |
| `compress@file` | Gzip/Brotli compression |

### Example Files

See the examples in `docker/traefik/examples/`:

- `docker-compose.override.example.yml` - Docker labels extension
- `custom-route.example.yml` - File provider routes

---

## ModSecurity WAF Configuration

ModSecurity provides OWASP Core Rule Set (CRS) protection for the API. The frontend serves static assets and bypasses the WAF.

### Architecture

```
Client -> Traefik -> ModSecurity -> API Server
         (TLS)     (inspects)     (processes)
```

### Paranoia Levels

The paranoia level controls how aggressive the WAF rules are:

| Level | Description | Use Case |
|-------|-------------|----------|
| 1 | Low false positives, basic protection | Most sites (default) |
| 2 | Moderate protection, some false positives | Sites with simple APIs |
| 3 | High security, more false positives | Financial, healthcare |
| 4 | Maximum security, requires extensive tuning | High-value targets |

Configure in `.env`:

```bash
MODSEC_PARANOIA_LEVEL=1
```

### Anomaly Scoring

ModSecurity uses anomaly scoring to decide whether to block requests:

```bash
# Lower = stricter (blocks more)
MODSEC_ANOMALY_INBOUND=5   # Default: 5
MODSEC_ANOMALY_OUTBOUND=4  # Default: 4
```

### Detection-Only Mode

Test rules without blocking:

```bash
MODSEC_ENABLED=DetectionOnly
```

Check logs for what would be blocked:

```bash
docker compose -f docker-compose.traefik.yml logs modsecurity | grep -i blocked
```

### Troubleshooting False Positives

1. **View ModSecurity audit logs:**

   ```bash
   docker compose -f docker-compose.traefik.yml logs modsecurity
   ```

2. **Identify the rule ID from logs** (look for `id "XXXXXX"`):

   ```
   ModSecurity: Warning. Match of "..." against "..." detected
   [id "920350"] [msg "Host header is a numeric IP address"]
   ```

3. **Create rule exclusion:**

   For production, you can mount custom rule exclusions. Create a file with:

   ```
   SecRuleRemoveById 920350
   ```

   Mount it in your override:

   ```yaml
   services:
     modsecurity:
       volumes:
         - ./modsecurity-overrides:/etc/modsecurity.d/owasp-crs/custom:ro
   ```

4. **Common false positives:**
   - `920350` - Numeric IP in Host header (testing)
   - `949110` - Anomaly score threshold
   - `980130` - Correlated attack

### Disabling WAF (Not Recommended)

For debugging only:

```bash
MODSEC_ENABLED=false
```

---

## SeaweedFS Configuration

SeaweedFS provides S3-compatible object storage for file uploads.

### Configuration

```bash
# Maximum volume size (MB)
# Basic deployment: 1000 (1GB)
# Production: 30000 (30GB)
SEAWEEDFS_VOLUME_SIZE_LIMIT_MB=30000

# S3 credentials
S3_ACCESS_KEY=openclaw
S3_SECRET_KEY=<your-secret-key>
S3_BUCKET=openclaw
```

### Data Persistence

Data is stored in the `seaweedfs_data` Docker volume:

```bash
# List volumes
docker volume ls | grep seaweedfs

# Inspect volume
docker volume inspect openclaw-projects_seaweedfs_data
```

### Using External S3 (AWS, MinIO, etc.)

To use external S3 instead of SeaweedFS:

1. **Remove SeaweedFS from compose** (create override):

   ```yaml
   # docker-compose.override.yml
   services:
     seaweedfs:
       deploy:
         replicas: 0
   ```

2. **Configure external S3:**

   ```bash
   S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
   S3_BUCKET=your-bucket-name
   S3_REGION=us-east-1
   S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
   S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   S3_FORCE_PATH_STYLE=false  # Set to false for AWS S3
   ```

---

## Backup and Restore

### PostgreSQL Backup

**Create backup:**

```bash
# Using pg_dump
docker compose exec db pg_dump -U openclaw -d openclaw -Fc > backup-$(date +%Y%m%d).dump

# Or with custom format and compression
docker compose exec db pg_dump -U openclaw -d openclaw -Fc -Z9 > backup-$(date +%Y%m%d).dump.gz
```

**Restore backup:**

```bash
# Stop API to prevent writes
docker compose stop api

# Restore
docker compose exec -T db pg_restore -U openclaw -d openclaw --clean --if-exists < backup.dump

# Restart API
docker compose start api
```

**Automated backups with cron:**

```bash
# /etc/cron.d/openclaw-backup
0 3 * * * root cd /path/to/openclaw-projects && docker compose exec -T db pg_dump -U openclaw -d openclaw -Fc > /backups/openclaw-$(date +\%Y\%m\%d).dump 2>&1
```

### SeaweedFS Backup

**Volume backup:**

```bash
# Find volume location
docker volume inspect openclaw-projects_seaweedfs_data

# Create tarball
docker run --rm -v openclaw-projects_seaweedfs_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/seaweedfs-$(date +%Y%m%d).tar.gz -C /data .
```

**Volume restore:**

```bash
# Stop SeaweedFS
docker compose stop seaweedfs

# Restore
docker run --rm -v openclaw-projects_seaweedfs_data:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/seaweedfs-YYYYMMDD.tar.gz -C /data"

# Restart
docker compose start seaweedfs
```

### Traefik Certificates Backup

ACME certificates are stored in the `traefik_acme` volume:

```bash
# Backup
docker run --rm -v openclaw-projects_traefik_acme:/data -v $(pwd):/backup alpine \
  tar czf /backup/traefik-acme-$(date +%Y%m%d).tar.gz -C /data .

# Restore
docker run --rm -v openclaw-projects_traefik_acme:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/traefik-acme-YYYYMMDD.tar.gz -C /data"
```

---

## Upgrading Containers

### Pull Latest Images

```bash
# Basic deployment
docker compose pull
docker compose up -d

# Production deployment
docker compose -f docker-compose.traefik.yml pull
docker compose -f docker-compose.traefik.yml up -d
```

### Specific Version

Pin to specific versions in your override file:

```yaml
# docker-compose.override.yml
services:
  api:
    image: ghcr.io/troykelly/openclaw-projects-api:v1.2.3
  app:
    image: ghcr.io/troykelly/openclaw-projects-app:v1.2.3
  db:
    image: ghcr.io/troykelly/openclaw-projects-db:v1.2.3
```

### Database Migrations

Migrations run automatically on startup via the `migrate` service. To run manually:

```bash
# Check current version
docker compose run --rm migrate -path /migrations -database "postgresql://..." version

# Apply migrations
docker compose run --rm migrate -path /migrations -database "postgresql://..." up

# Rollback one migration
docker compose run --rm migrate -path /migrations -database "postgresql://..." down 1
```

### Zero-Downtime Updates

For production with minimal downtime:

```bash
# Pull new images
docker compose -f docker-compose.traefik.yml pull

# Update one service at a time
docker compose -f docker-compose.traefik.yml up -d --no-deps api
docker compose -f docker-compose.traefik.yml up -d --no-deps app

# Migrations run automatically if needed
```

---

## Troubleshooting

### Common Issues

#### Services Won't Start

**Check logs:**

```bash
docker compose logs -f
# Or specific service
docker compose logs -f api
```

**Check health:**

```bash
docker compose ps
```

#### Database Connection Refused

```bash
# Check DB is healthy
docker compose ps db

# Check DB logs
docker compose logs db

# Test connection
docker compose exec db psql -U openclaw -d openclaw -c "SELECT 1"
```

#### TLS Certificate Issues

```bash
# Check Traefik logs for ACME errors
docker compose -f docker-compose.traefik.yml logs traefik | grep -i acme

# Verify DNS is pointing correctly
dig +short api.example.com

# Check certificate status
echo | openssl s_client -connect api.example.com:443 -servername api.example.com 2>/dev/null | openssl x509 -text -noout | grep -A2 "Validity"
```

#### ModSecurity Blocking Requests

```bash
# Check audit logs
docker compose -f docker-compose.traefik.yml logs modsecurity | tail -100

# Enable detection-only mode temporarily
# Set MODSEC_ENABLED=DetectionOnly in .env
docker compose -f docker-compose.traefik.yml up -d modsecurity
```

#### Out of Disk Space

```bash
# Check Docker disk usage
docker system df

# Clean up unused resources
docker system prune -a --volumes

# Check volume sizes
docker system df -v | grep -E "VOLUME|seaweedfs|db_data"
```

#### HTTP/3 Not Working

```bash
# Verify UDP port is open
ss -ulnp | grep 443

# Check firewall allows UDP 443
# For UFW:
sudo ufw allow 443/udp

# Test with curl (requires HTTP/3 support)
curl --http3 https://example.com
```

### Getting Help

1. **Check logs** for specific error messages
2. **Search issues** at https://github.com/troykelly/openclaw-projects/issues
3. **Create an issue** with:
   - Docker and Docker Compose versions
   - Relevant logs (sanitize secrets)
   - Your `.env` configuration (without secrets)
   - Steps to reproduce

### Diagnostic Commands

```bash
# Service status
docker compose ps

# Resource usage
docker stats

# Network connectivity
docker compose exec api ping db
docker compose exec api wget -q -O- http://seaweedfs:8333

# Check container health
docker inspect --format='{{.State.Health.Status}}' openclaw-api

# View environment
docker compose exec api env | sort

# Check volumes
docker volume ls
docker volume inspect openclaw-projects_db_data
```
