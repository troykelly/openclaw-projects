# Ops Runbook (production Docker)

This repo includes a **production** Docker Compose file: `docker-compose.yml`.

The compose file uses published images from `ghcr.io/troykelly/openclaw-projects-*`.

## Deploy layout on VM

Recommended layout:

- `/opt/openclaw-projects/` (repo checkout)
- `/opt/openclaw-projects/.env` (secrets + config; **not** committed)
- Docker volumes created automatically (`db_data`, `seaweedfs_data`)

Example:

```bash
sudo mkdir -p /opt/openclaw-projects
sudo chown -R $USER:$USER /opt/openclaw-projects
cd /opt/openclaw-projects

git clone https://github.com/troykelly/openclaw-projects.git .
git checkout main

cp .env.example .env
$EDITOR .env

# Set required values in .env:
# - POSTGRES_PASSWORD
# - COOKIE_SECRET
# - S3_SECRET_KEY

docker compose pull
docker compose up -d
```

The migrate service runs automatically on startup and exits when complete.

Health:

```bash
curl -fsS http://127.0.0.1:3000/health
```

## Services

| Service | Port (default) | Description |
|---------|----------------|-------------|
| db | - | PostgreSQL 18 with TimescaleDB, pgvector, pg_cron |
| api | 3000 | Fastify API server |
| app | 8080 | Frontend (nginx) |
| seaweedfs | 8333 | S3-compatible object storage |
| migrate | - | Database migrations (runs once and exits) |

## Traefik wiring

For production with TLS, use `docker-compose.traefik.yml` (coming soon in #529).

The basic compose publishes the API on **127.0.0.1:${API_PORT:-3000}** and frontend on **127.0.0.1:${FRONTEND_PORT:-8080}**.

### Option A: Traefik file-provider (current VM pattern)

Point your Traefik dynamic config at the localhost services.

Example (`ops/traefik/dynamic.yml`):

- Route: `Host(...) && (PathPrefix(\`/dashboard\`) || PathPrefix(\`/api\`) || Path(\`/health\`))`
- Service URL: `http://127.0.0.1:${API_PORT}`

### Option B: Traefik docker-provider

If you run Traefik with the docker provider:

- Remove the `ports:` mapping in `docker-compose.yml`
- Attach both Traefik and the services to the same docker network
- Add `traefik.http.routers.*` / `traefik.http.services.*` labels

(We default to file-provider for simplicity and to match the existing VM config.)

## Development

For local development, use the devcontainer which provides its own compose file at `.devcontainer/docker-compose.devcontainer.yml`.

The `db:up` and `db:down` scripts in `package.json` reference this devcontainer compose for local development.

## Notes

- Database image is built from `docker/postgres/Dockerfile` (Postgres 18 + TimescaleDB, PostGIS, pg_cron, pgvector)
- Extensions are created by migrations (see `migrations/007_required_extensions.up.sql`)
- All containers are hardened: non-root, read-only filesystems, dropped capabilities
