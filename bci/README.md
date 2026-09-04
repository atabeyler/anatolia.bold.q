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

**M4 — Job Orchestration**
- `scan_jobs`: a Postgres-backed queue (`SELECT ... FOR UPDATE SKIP LOCKED`,
  no external broker — BCI must run standalone, air-gapped deployments
  included) with a full status lifecycle (QUEUED → ANALYZING → ... →
  COMPLETED/FAILED/CANCELLED/TIMED_OUT)
- `POST /api/v1/scans` never creates a job on a policy DENY — it calls the
  same `evaluateScopeAuthorization` from M2 before inserting anything
- Bounded, idempotent retry (`max_attempts`) and a timeout sweep that
  recovers jobs stuck in-flight after a worker crash
- `src/worker.js` — a **separate process** from the API (spec section 6:
  scan/data plane isolated from control plane), polling workers with
  configurable concurrency and a `job_workers` heartbeat table for worker
  health; run it with `npm run worker --prefix bci`
- No engine adapters exist yet (M5), so the worker currently runs a stub
  analysis — that stub is exactly the seam M5's real adapters plug into

**M5 — Hybrid Engine Adapters**
- `src/engines/EngineAdapter.js` — the adapter contract (duck-typed:
  `id`, `intrusiveness`, `supportedTargetTypes`, `healthCheck()`,
  `execute()`); today's engine can be swapped for tomorrow's without
  touching anything outside its own adapter module
- Five adapters, each a thin wrapper around a real CLI via `execFile`-style
  `spawn` (argv array, never a shell string — no command injection surface):
  - **Trivy** (Apache-2.0) — filesystem/container SCA + secrets + IaC, PASSIVE
  - **OSV-Scanner** (Apache-2.0) — lockfile/SBOM vulnerability matching, PASSIVE
  - **Semgrep** (LGPL-2.1) — SAST, PASSIVE
  - **Nuclei** (MIT) — template-based HTTP probing, SAFE_ACTIVE; ships a
    bundled BCI-native template (`src/engines/templates/nuclei/`) instead of
    depending on `nuclei -update-templates`, which needs the internet and
    can't work in a Sovereign/air-gapped deployment (spec section 52)
  - **naabu** (MIT) — TCP port discovery, SAFE_ACTIVE; used **instead of
    Nmap**, whose license restricts bundling into a redistributed product
    without a separate license from Insecure.Com LLC (spec section 68)
- `engine_registry` + `engine_health` (`GET /api/v1/engines`) — an engine
  that isn't installed reports OFFLINE, not a crash; a dead engine must
  never make a run silently look fully covered (spec section 48)
- `raw_observations` — engine-native output, stored as-is; turning this
  into BCI's common schema is Normalization's job (M6), not an adapter's
- Not yet wired into `scan_jobs` execution — picking which engines run for
  a given target is the Analysis Planner's job (spec section 9), a
  separate concern from "does the adapter itself work"

**M6 — Normalization**
- One normalizer per engine (`src/normalization/normalizers/`), each a pure
  function mapping that engine's real, captured JSON shape into BCI's
  common `normalized_observations` schema (spec section 16: category,
  title, severity, cve_ids/cwe_ids, cvss, component, location, evidence,
  references, ...) — an external engine's severity string is kept as
  `engine_severity` for explainability, never used as BCI's own severity
- `services/normalization.js`: `storeRawObservation()` writes the engine's
  output byte-for-byte into `raw_observations` first; `normalizeStoredObservation()`
  reads it back and writes the normalized rows — two steps on purpose, so a
  normalizer bug can never mean the original engine output is lost
- Evidence redaction (`src/normalization/redact.js`): `Authorization`/
  `Cookie`/`Set-Cookie`/`X-Api-Key` lines in Nuclei's raw request/response
  text are stripped before anything is stored as evidence (spec section 36)
- Normalizer unit tests run against real captured tool output
  (`test/fixtures/normalization/`) — no scanner binaries needed to run them,
  unlike M5's adapter tests
- `GET /api/v1/observations?jobId=...` — read-only view onto normalized
  output; still not a Finding (that's Correlation/Verification, M7)

Wiring engines into job execution (the Analysis Planner), correlation,
findings, risk/confidence scoring, etc. land in later milestones (M7+).

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
