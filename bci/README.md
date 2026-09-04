# BCI API — M1 Foundation

Independent backend for the BOLD Cyber Intelligence (BCI) platform. This
directory does not depend on ANATOLIA-Q's `server/` or `client/`; it has its
own `package.json`, its own database connection, and its own Docker image.
ANATOLIA-Q may call BCI as a service; BCI must never depend on ANATOLIA-Q.

## Scope

**M1 — Foundation**
- Express API skeleton, request-id + structured (pino) logging
- Fail-closed env validation (`BCI_DATABASE_URL`, `BCI_JWT_SECRET` required in production)
- Own PostgreSQL connection + a plain SQL-file migration runner
- Liveness/readiness health endpoints (`/api/v1/health/live`, `/ready`)
- Standalone Dockerfile

**M2 — Identity / RBAC / Scope / Policy**
- Multi-tenant `organizations` + `users`, JWT auth (`POST /api/v1/auth/login`, `GET /api/v1/auth/me`)
- Static role/permission catalog (six roles: viewer, analyst, operator,
  security_admin, auditor, system_admin) enforced server-side via
  `requirePermission(...)` middleware — never trust a hidden UI button
- `authorized_scopes` + a deny-by-default Policy Engine
  (`POST /api/v1/scopes/evaluate`): no matching **approved**, non-expired,
  class-matching, non-excluded scope means DENY, unconditionally
- Propose/approve separation: `scope:create` only produces a `PENDING`
  record; a distinct `scope:approve` permission is required to activate it
- Append-only audit ledger (`GET /api/v1/audit`), one write path
  (`services/audit.js`), every policy decision and auth/scope action logged
- First-boot bootstrap (`BCI_BOOTSTRAP_*` env vars) creates exactly one
  organization + system_admin user, and only if none exists yet
- Cross-tenant isolation tests: org A can never see, approve, or forge its
  way into org B's data

**M3 — Asset Inventory**
- `assets` (typed: DOMAIN/HOST/WEB_APP/API/REPOSITORY/CONTAINER/CLOUD_RESOURCE/IDENTITY/SERVICE,
  with a LOW..CRITICAL criticality) under `/api/v1/assets`
- `asset_identifiers` (domain/IP/CIDR/repo URL/...) and `asset_technologies`
  (detected tech + version) as sub-resources of an asset
- `asset_relationships` (HOSTS/DEPENDS_ON/CONNECTS_TO/CONTAINS/RUNS/EXPOSES)
  — a minimal precursor to the full Security Graph (M10)
- Every read/write is scoped by `org_id`; an id from another tenant returns
  404, not 403, and cross-org relationships are rejected

Job queue, engine adapters, findings, risk/confidence scoring, etc. land in
later milestones (M4+) — none of that exists here yet.

## Development

```bash
npm install --prefix bci
cp bci/.env.example bci/.env
npm run migrate --prefix bci
npm run dev --prefix bci
npm test --prefix bci
```

## Architecture note

```
ANATOLIA-Q  →  BCI Gateway  →  BCI API  →  BCI Database
```

Dependency direction is one-way: ANATOLIA-Q may use BCI; BCI never imports
ANATOLIA-Q code, never shares its database, and never uses its
authentication/authorization system.
