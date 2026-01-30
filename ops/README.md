# Ops Runbook (production Docker)

This repo includes a **production** Docker Compose file: `docker-compose.prod.yml`.

## Deploy layout on VM

Recommended layout:

- `/opt/clawdbot-projects/` (repo checkout)
- `/opt/clawdbot-projects/.env` (secrets + config; **not** committed)
- Docker volume `postgres_data` (created automatically)

Example:

```bash
sudo mkdir -p /opt/clawdbot-projects
sudo chown -R $USER:$USER /opt/clawdbot-projects
cd /opt/clawdbot-projects

git clone https://github.com/troykelly/clawdbot-projects.git .
git checkout main

cp .env.example .env
$EDITOR .env

docker compose -f docker-compose.prod.yml pull || true
docker compose -f docker-compose.prod.yml up -d --build

# Run migrations (idempotent)
docker compose -f docker-compose.prod.yml run --rm migrate
```

Health:

```bash
curl -fsS http://127.0.0.1:3000/health
```

## Traefik wiring

The production compose publishes the projects service on **127.0.0.1:${PROJECTS_PORT}**.

### Option A: Traefik file-provider (current VM pattern)

Point your Traefik dynamic config at the localhost service.

Example (`ops/traefik/dynamic.yml`):

- Route: `Host(...) && (PathPrefix(`/dashboard`) || PathPrefix(`/api`) || Path(`/health`))`
- Service URL: `http://127.0.0.1:${PROJECTS_PORT}`

### Option B: Traefik docker-provider

If you run Traefik with the docker provider, prefer:

- remove the `ports:` mapping in `docker-compose.prod.yml`
- attach both Traefik and `projects` to the same docker network
- add `traefik.http.routers.*` / `traefik.http.services.*` labels to the `projects` service

(We default to file-provider for simplicity and to match the existing VM config.)

## Notes

- Postgres is built from `docker/postgres/Dockerfile` (Postgres 18 + TimescaleDB, PostGIS, pg_cron, pgvector)
- Extensions are created by migrations (see `migrations/007_required_extensions.up.sql`).
