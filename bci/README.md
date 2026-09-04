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

**M7 — Correlation & Verification**
- `findings` + `finding_sources`: Correlation groups `normalized_observations`
  by a correlation key (shared CVE first, then rule+location, then
  category+location) and upserts one Finding per key — `UNIQUE(org_id,
  correlation_key)` plus `ON CONFLICT` merging makes re-running correlation
  idempotent; it never creates a duplicate Finding or double-counts a source
- **Verification Engine v1** (`services/verification.js`): WEB/API/
  NETWORK_DISCOVERY observations are CONFIRMED on the spot (the engine
  already did a live, safe check as part of detecting them); 2+ distinct
  engines agreeing on a static finding is also CONFIRMED; a lone SECRETS hit
  is MANUAL_REVIEW_REQUIRED (spec section 18 calls this out as a
  false-positive-prone category); anything else is LIKELY
- **Confidence Engine v1** (`services/confidence.js`): independent of Risk —
  a base score from distinct-source count, a bump for CONFIRMED
  verification and for a concrete CVSS score, capped at 50 whenever manual
  review is required. Both engines are pure functions, versioned
  (`VERIFICATION_MODEL_VERSION` / `CONFIDENCE_MODEL_VERSION`) so an old
  Finding's scores stay explainable against the model that produced them
- Finding lifecycle (`/api/v1/findings`): general workflow transitions
  (ASSIGNED/IN_REMEDIATION/READY_FOR_VERIFICATION/MITIGATED/DEFERRED) need
  `finding:update`; the verification decisions (confirm/false-positive/
  accept-risk) need the stronger `finding:verify` — every change is audited

**M8 — Vulnerability Intelligence Platform**
- `vulnerabilities` knowledge base merging three free, no-API-key sources:
  **CISA KEV** (full-catalog sync — it's one JSON document, not a crawl),
  **FIRST EPSS** (exploitation-probability scoring), and **NVD CVE 2.0**
  (description/CVSS/CWE) — real end-to-end smoke-tested against all three
  live APIs (1694 real KEV entries synced; a real CVE enriched with live
  NVD+EPSS data) during development
- `getOrEnrichVulnerability()` is lazy and on-demand, never a bulk NVD
  crawl: reads the local cache first, only reaches out live when a row is
  missing or >30 days stale, and on a live-fetch failure falls back to
  whatever's cached rather than erroring (spec section 62) — an
  `intelligence_updates` row records every sync attempt (source, SUCCESS/
  FAILED, item count) so a caller can see a source's actual freshness
  instead of assuming it
- `upsertVulnerability()` merges via `COALESCE(new, existing)` — no source
  can ever blank out a field a different source already populated, and
  `kev` only ever flips true, never back to false
- Each source has a pure parser (`src/intelligence/sources/`), unit-tested
  against captured real API responses, separate from the thin fetch wrapper
  around it
- `GET /api/v1/intelligence/vulnerabilities/:cveId` (`intel:view`),
  `GET /api/v1/intelligence/freshness` (`intel:view`),
  `POST /api/v1/intelligence/sync-kev` (`intel:manage` — an outbound network
  call, gated stronger than a read)

**M9 — Risk / Confidence / Coverage**
- **BCI Risk Score v1** (`services/risk.js`): CVSS stays the technical
  reference — this builds on top of it with EPSS, KEV, asset criticality,
  and confidence, never replacing it. Confidence explicitly *dampens* risk
  (0.5×–1.0× factor) rather than gating it off, so a high-severity,
  low-confidence finding reads as lower risk without disappearing — the
  spec section 24 worked example ("Risk 97, Confidence 41" must not look
  like "Risk 97, Confidence 99")
- **BCI Priority** (`computePriority`): a separate axis from the numeric
  score — KEV listing alone forces IMMEDIATE regardless of exactly where
  the score landed, because active exploitation is categorical, not a
  matter of degree
- Correlation (M7) now calls `recomputeFindingRisk` every time a Finding's
  sources change, so risk never goes stale from a Finding's original
  creation; `risk_history` keeps one append-only row per recompute so an
  old score stays explainable even after the live one has moved on
- **BCI Security Score** (`services/securityScore.js`): NOT an average — a
  handful of open critical findings hurt more than many low ones (tiered
  deduction), and closed/false-positive/accepted-risk findings stop
  counting entirely
- **BCI Coverage Score** (`services/coverageScore.js`): per asset type,
  which analysis categories are expected (a REPOSITORY expects SAST+SCA+
  SECRETS; a HOST expects NETWORK_DISCOVERY; ...) versus how many have ever
  actually been observed — an org with a high Security Score and low
  Coverage Score is flagged as under-analyzed, not falsely "secure"
- `GET /api/v1/risk/security-score`, `GET /api/v1/risk/coverage-score`
  (`report:view`)

**M10 — Security Graph**
- `security_graph_nodes`/`security_graph_edges` are a **projection**, not a
  second place to enter data: `syncSecurityGraph(orgId)` rebuilds them from
  `assets`, `asset_relationships`, and open `findings`/CVEs every time it's
  called — idempotent via `ON CONFLICT` upserts, safe to re-run
- Asset nodes + structural edges (HOSTS/DEPENDS_ON/CONNECTS_TO/CONTAINS/
  RUNS/EXPOSES) come straight from M3's `asset_relationships`; an
  `AFFECTED_BY` edge links an asset to a CVE node whenever an open finding's
  target matches one of that asset's identifiers
- **Defensive attack-path analysis** (`findReachableAssets`): BFS outward
  from a given asset over structural edges only — never through
  `AFFECTED_BY`, which is a leaf fact being asked about, not something to
  traverse further — answering "which critical systems could this
  vulnerability affect indirectly" (spec section 31). No automatic
  exploitation, ever; this only walks facts already in the inventory
- `POST /api/v1/graph/sync` (`asset:update` — it writes derived data),
  `GET /api/v1/graph/assets/:assetId/reachable` (`asset:view` — read-only)

**M11 — Remediation & Verify**
- `remediations`: assigning one moves a `NEW` finding to `ASSIGNED`;
  marking it `DONE` moves the finding to `READY_FOR_VERIFICATION` — the
  finding's own status lifecycle stays the single source of truth, this
  just drives it
- **BCI Verify** (`services/verify.js`, spec section 35): a *targeted*
  re-check, never a full re-scan. Only re-checkable when the original
  detection was itself a live probe: a WEB finding re-runs Nuclei with
  `-template-id <the original rule>` against just that target; a
  NETWORK_DISCOVERY finding re-runs naabu against just that port. A static
  SAST/SCA/SECRETS finding has no live signal to re-observe without a fresh
  checkout this milestone doesn't have, so it's honestly `INCONCLUSIVE`
  rather than guessed at — and a re-check is still policy-gated through the
  same `evaluateScopeAuthorization` as any other active probe: no approved
  SAFE_ACTIVE scope means `INCONCLUSIVE`, never a silent bypass
- `FIX_VERIFIED` moves the finding to `VERIFIED_FIXED`; every attempt
  (including `INCONCLUSIVE`) is kept in `verification_runs`, append-only
- Real end-to-end tests against a self-owned local target: a missing-HSTS
  Nuclei finding is `VULNERABILITY_REMAINS` while unfixed and
  `FIX_VERIFIED` the moment the header is added; an open-port naabu finding
  the same way once the port is closed

**M12 — Reporting**
- Four report types (`src/reports/builders.js`), each pulling from data
  already built in earlier milestones rather than duplicating logic:
  **Executive** (security/coverage score, KEV exposure, top risks),
  **Technical** (every finding plus which engines corroborated it),
  **Remediation** (findings joined to their remediation status, sorted by
  priority), **Audit** (the audit ledger itself, for a time window — this
  report *is* the compliance evidence, not a summary of it)
- Integrity metadata on every report (spec section 46): a canonical-JSON
  SHA-256 content hash, the BCI version, and the exact version of every
  scoring model (`risk`, `confidence`, `verification`, `securityScore`,
  `coverageScore`) that could have shaped the content — so a report stays
  reproducible/explainable even after those models have since changed
- `getReport()` recomputes the hash on every read and reports
  `integrityValid` — tampering (even a direct DB edit) is detected, not
  silently trusted
- `POST /api/v1/reports` (`report:export` — generating is the
  exportable-artifact action); `GET /api/v1/reports` and `GET
  /api/v1/reports/:id` (`report:view`)

**M13 — AI Decision Support**
- Provider abstraction (`src/ai/`): `AI_DISABLED` is the default and the
  only mode implemented besides `EXTERNAL_AI` (an Anthropic provider) —
  `LOCAL_AI`/`PRIVATE_AI` fall back to disabled rather than throwing, since
  they aren't built yet (spec section 43's four modes)
- **AI is never on the path that makes a security decision** — it only
  explains a Finding whose risk/confidence/priority were already computed
  deterministically (M7/M9). `explainFinding()` always returns something: a
  real AI explanation when a provider is healthy, otherwise a deterministic
  plain-language summary built from the Finding's own fields — spec section
  62's "AI unavailable → base analysis continues" is enforced by construction
  here, not by hoping the provider stays up
- **DLP layer** (`src/ai/dlp.js`): redacts AWS keys, bearer tokens, generic
  `password=`/`api_key=` assignments, and PEM private-key blocks from any
  text before it would reach an external provider — independent of and in
  addition to M6's HTTP-evidence redaction
- **Hallucination control** (spec section 42, "AI yorumlar; kanıt
  doğrular"): `verifyExploitationClaim()` never takes an "actively
  exploited" claim on its own word — it's checked against the M8
  intelligence knowledge base and only reported `CONFIRMED` when CISA KEV
  actually backs it up, `UNVERIFIED` otherwise
- `GET /api/v1/findings/:id/explain` (`finding:view`),
  `GET /api/v1/intelligence/vulnerabilities/:cveId/exploitation-claim`
  (`intel:view`) — both audited, including provider failures, not just successes

**M14 — ANATOLIA-Q Integration**
- `POST /api/v1/gateway/session` is the one trust boundary between the two
  products: ANATOLIA-Q signs a short-lived token with `BCI_GATEWAY_SECRET`
  (a secret distinct from and never shared with BCI's own `BCI_JWT_SECRET`)
  asserting one of its own users' identity/role, and gets back a normal BCI
  access token — from there on, BCI's own RBAC (M2) enforces every
  permission exactly as it would for a native BCI user
- Auto-provisions a "shadow" BCI user per external identity under a
  dedicated `anatolia-q` organization, idempotently, keeping the mapped
  role in sync on every visit — an unrecognized role never escalates past
  `viewer`. A shadow user has an unusable random password and is explicitly
  blocked from `POST /api/v1/auth/login` (`external_source` column):
  the gateway token is the only way in
  - Role mapping (ANATOLIA-Q → BCI): `admin` → `security_admin`,
    `analyst` → `analyst`, anything else → `viewer`
- On the ANATOLIA-Q side (`server/src/services/bciClient.js`,
  `server/src/routes/cyberAnalysis.js`): a small, admin/analyst-only proxy
  under `/api/cyber-analysis/*` — the browser never talks to BCI directly
  or holds a BCI token, matching the spec section 55 trust-boundary diagram
  (ANATOLIA client → ANATOLIA server → BCI Gateway → BCI API). A BCI outage
  or missing config degrades to a clean `503`, never a crashed ANATOLIA-Q
  request. A minimal Cyber Analysis page (`client/src/pages/CyberAnalysisPage.jsx`)
  shows BCI's own Security/Coverage scores and findings — "BCI Vulnerability
  Analysis"/"BCI Risk Analysis" language, never the third-party scanner
  names underneath (spec section 56)
- Full ANATOLIA-Q regression run after this change: server 538/538, client
  589/589, both green; `server/tsc --noEmit` and both projects' `eslint`
  clean

**M15 — Standalone BCI UI**
- A minimal but real React frontend under `bci/ui/` (its own Vite app,
  own tests) — see [`bci/ui/README.md`](./ui/README.md) for the page list.
  Not the full 17-area surface from the long-term spec, but every page that
  exists is wired to a live endpoint and does what it says, verified
  end-to-end during development against a real running BCI API with a
  headless browser (login → dashboard scores → creating an asset through
  the UI and seeing it land in the database → logout)
- RBAC stays server-side: the UI only hides actions a token lacks
  permission for, never the only check

**M16 — Enterprise / Sovereign**
- **Offline Intelligence Bundle** (spec section 53): Ed25519-signed exports
  of the local vulnerabilities knowledge base
  (`scripts/bundle-{export,import}.js`) — asymmetric, so an air-gapped
  instance only ever holds the public key, never anything that could forge
  a bundle. A bad signature or a tampered payload imports nothing at all.
  Verified end-to-end during development: exported from one database,
  imported into a completely separate one, confirmed the data landed; a
  wrong-key attempt confirmed rejected with a non-zero exit code
- **Backup/restore** (`scripts/backup.sh` / `restore.sh`): plain
  `pg_dump`/`pg_restore` wrappers, verified with a real round trip (backup
  → restore into a fresh database → all 32 tables and the data intact)
- **Release checksums** (`scripts/generate-checksums.js`): SHA-256 per file
  in a build directory, verified against a real `bci/ui` build
- See [`ENTERPRISE.md`](./ENTERPRISE.md) for the full picture, including
  what's genuine deployment guidance (HA/scaling posture, the Sovereign
  checklist) rather than new code — kept clearly separate from what's
  actually implemented and tested above

This closes all 16 milestones from the original spec. BCI is a real,
tested, end-to-end platform: RBAC/policy, asset inventory, job
orchestration, five real scanning engines, normalization/correlation/
verification, a vulnerability intelligence platform, risk/confidence/
coverage scoring, a security graph, remediation/verify, reporting, AI
decision support, ANATOLIA-Q integration, a standalone UI, and
enterprise/sovereign deployment tooling — 171 tests, no regressions
introduced in ANATOLIA-Q (1127+ of its own tests still green).

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
