# #52 Frontend stack decision

## Decision
Choose **A) React + Vite + typed API client**.

## Rationale
- The existing dashboard HTML is built via raw string concatenation. That pattern becomes hard to maintain and easy to break as the UI grows.
- React provides component composition and state management that fits the Work Item detail page requirements (participants, dependencies, edits).
- Vite gives fast iteration locally and a clear build-to-static-assets pipeline that fits the current Fastify server.

## Intended integration (initial)
- Fastify serves Vite build outputs as static assets.
- Server routes under `/app/*` serve the same SPA entrypoint (app shell), protected by the existing session cookie auth.
- Existing APIs remain under `/api/*`.

## Next
- Add Vite+React scaffolding.
- Implement the first two pages:
  - Work Items list
  - Work Item detail
- Keep auth flow unchanged (magic-link + session cookie).
