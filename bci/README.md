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
  class-matching, non-excluded scope means DENY, unconditionally. Matching
  is **typed** (`src/lib/targetMatcher.js`, 10 target types: DOMAIN,
  SUBDOMAIN, URL, IP, CIDR, REPOSITORY, API, CLOUD_ACCOUNT, CONTAINER,
  KUBERNETES_CLUSTER) with a canonical parser/matcher per type — a CIDR is
  never matched by string suffix, a URL's path is never confused with a
  bare domain; anything unparseable fails closed (no match, not a guess)
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
- The worker runs the real pipeline (`services/analysisPipeline.js`,
  wired in after the M5-M9 pieces below existed to plug into): the
  Analysis Planner selects engines by the job's typed target, each runs
  against a prepared execution target (a REPOSITORY is cloned into a
  temp dir with `git clone --depth 1`, cleaned up after; other target
  types run directly), raw output is normalized, new CVEs are enriched
  against the M8 intelligence base, then Correlation (M7) and the
  Security Graph (M10) run — no stub left in this path

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
- Wired into `scan_jobs` execution via `services/analysisPlanner.js` +
  `services/analysisPipeline.js` — REPOSITORY gets Semgrep+OSV-Scanner+Trivy,
  CONTAINER gets Trivy in image mode, DOMAIN/SUBDOMAIN/URL/API get Nuclei
  (SAFE_ACTIVE+ only), IP/CIDR get naabu (SAFE_ACTIVE+ only); CLOUD_ACCOUNT
  and KUBERNETES_CLUSTER honestly plan zero engines (no adapter exists yet)
  rather than pretending to scan them

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
- Later extended with a **Quantum & PQC** page (Quantum Compute Gateway
  provider health, execution policy, the Remediation Optimizer, benchmark
  results and quantum job history, Crypto Discovery, Crypto Inventory,
  PQC Readiness, and Migration Roadmap) once the Quantum Compute Gateway
  and Post-Quantum Security Engine below existed to display — verified
  end-to-end the same way against a real running BCI API and a real TLS
  discovery against `example.com`

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
enterprise/sovereign deployment tooling.

## Quantum Compute Gateway (IMPLEMENTED, IBM hardware EXPERIMENTAL)

BCI's value is Discovery + Vulnerability Intelligence + Verification +
Security Graph + Risk Decisioning + Remediation + AI in one platform —
**not** using IBM Quantum. Quantum is one optional compute backend behind a
provider-agnostic gateway, used only where it demonstrably helps; the
default for every org is CLASSICAL, and BCI is fully functional — including
in an air-gapped Sovereign deployment — with quantum entirely absent.

- **`src/quantum/QuantumComputeGateway.js`** (IMPLEMENTED) — the contract
  every provider implements: `submitOptimizationProblem` / `getJobStatus` /
  `getResult` / `getProviderHealth` / `getCapabilities`, plus the shared
  enums `COMPUTE_MODES` (CLASSICAL / QUANTUM_INSPIRED / QUANTUM_SIMULATOR /
  QUANTUM_HARDWARE) and `PROVIDER_HEALTH` (AVAILABLE / DEGRADED /
  UNAVAILABLE / NOT_CONFIGURED). BCI never embeds IBM-specific code outside
  its one adapter — swapping or adding a provider never touches policy,
  benchmarking, or the optimizers built on top
- **Four providers** (`src/quantum/providers/`), all solving the same 0/1
  knapsack problem instance so results are actually comparable:
  - **classical** (IMPLEMENTED) — exact dynamic-programming solver
    (`src/quantum/knapsack.js`), always AVAILABLE, provably optimal for
    integer costs. This is the mandatory baseline everything else is
    measured against
  - **quantum_inspired** (IMPLEMENTED) — simulated annealing with a seeded
    PRNG (reproducible runs), always AVAILABLE, no external dependency
  - **quantum_simulator** (IMPLEMENTED) — real QAOA (Quantum Approximate
    Optimization Algorithm) run on `qiskit_aer.AerSimulator`
    (`bci/quantum/optimize_knapsack_qaoa.py`, its own isolated
    `bci/quantum/requirements.txt`: qiskit 2.5.2, qiskit-aer 0.17.2 —
    deliberately **not** shared with ANATOLIA-Q's pinned server/quantum
    stack, so upgrading one can never break the other). The budget
    constraint is encoded exactly via binary slack qubits, not an
    approximate penalty. Health = OFFLINE if `qiskit_aer` isn't importable
  - **ibm_quantum** (EXPERIMENTAL — code complete, never run against a live
    IBM account: no token available in this environment) —
    `bci/quantum/ibm_backend.py`, written against the **current** IBM
    Quantum Platform SDK (`channel="ibm_quantum_platform"`,
    `SamplerV2(mode=backend)`), not copied from ANATOLIA-Q's older pinned
    adapter. Fixed-angle QAOA (no classical optimization loop against paid
    QPU time) as a deliberate cost guard. Reports NOT_CONFIGURED with no
    token, never crashes the gateway
- **Execution Policy** (`src/quantum/executionPolicy.js`, IMPLEMENTED) —
  per-org `quantum_policies` row (`allowQuantumSimulator`,
  `allowQuantumHardware`, `maxExternalDataClassification`), default
  denies all quantum. `decideExecutionMode` is a pure function: policy off →
  CLASSICAL; provider unhealthy or problem too large → fall back one step
  toward CLASSICAL, never error; data classification above the org's
  external-quantum ceiling (PUBLIC/INTERNAL/CONFIDENTIAL/SECRET) blocks IBM
  even when the org policy allows quantum hardware generally, falling back
  to the local simulator instead — SECRET data never leaves the machine.
  An unrecognized classification fails closed (never treated as
  low-sensitivity)
- **Benchmark Engine** (`src/quantum/benchmark.js`, IMPLEMENTED) — always
  runs classical + quantum-inspired, adds simulator/IBM only when policy
  and health allow. Records one `quantum_jobs` row per provider attempt
  (status, input/output hash, timestamps — provenance, never credentials)
  and one `quantum_benchmarks` row with a verdict of
  `QUANTUM_BENEFIT_OBSERVED` only when a quantum method's feasible
  objective value is **strictly greater** than the classical baseline's —
  otherwise `NO_QUANTUM_ADVANTAGE_DEMONSTRATED`. A failed provider attempt
  is recorded as FAILED, never silently dropped
- **Remediation Optimizer** (`src/services/remediationOptimizer.js`,
  IMPLEMENTED) — turns open findings into knapsack items (value from the
  existing deterministic Risk Score × a blast-radius multiplier from the
  Security Graph, cost from a documented category-based effort heuristic —
  not a precise cost model BCI has no basis to claim) and runs them through
  the Benchmark Engine to propose a remediation set under an effort budget.
  This is an advisory layer on top of the M9 Risk Score, which stays
  deterministic and explainable regardless of what the optimizer suggests
- **`GET/PUT /api/v1/quantum/policy`, `GET /api/v1/quantum/providers`,
  `POST /api/v1/quantum/remediation-optimize`, `GET /api/v1/quantum/benchmarks(/:id)`,
  `GET /api/v1/quantum/jobs`** — RBAC-gated (`system:manage` to change
  policy, `finding:update` to run the optimizer), cross-tenant
  isolation enforced (org A gets 404 on org B's benchmark)

36 new tests (knapsack, all four providers, execution policy including the
data-classification and fail-closed edge cases, benchmark integration
against a real database, remediation optimizer, and API RBAC/isolation).

### Post-Quantum Security Engine (IMPLEMENTED, real TLS discovery)

Separate from quantum *compute* usage above — this is about cryptographic
algorithms in use today that a future quantum computer could break, and
getting ahead of that migration. Every claim here is deliberately hedged the
way the spec demands: no "encryption is broken today," no marketing names,
a version-stamped classification table instead of a hardcoded judgment.

- **Crypto Discovery** (`src/services/cryptoDiscovery.js`) — four real
  discovery paths, never a mock parser:
  - **TLS** — a real handshake (`node:tls` + `node:crypto`'s
    `X509Certificate`) extracting the negotiated protocol/cipher and the
    certificate's actual public-key algorithm, key size (or curve),
    subject/issuer, and validity window. Verified against real local TLS
    servers with freshly-generated RSA-2048 and P-256 certificates
    (`openssl req -x509`)
  - **SSH** — real host keys via `ssh-keyscan` (OpenSSH), with the RSA/DSA
    key's actual modulus length decoded from the SSH wire-format key blob
    ourselves (`parseSshWireFields`/`mpintBitLength`) rather than just
    reporting the algorithm name — verified against a real local `sshd`
    with freshly-generated RSA-2048 and Ed25519 host keys
  - **JWT** — decodes a caller-supplied token's header only (`alg`, never
    verifies the signature) and classifies it; `HS*` is scored separately
    from the RSA/EC/PQC table as HMAC (Grover-affected, not Shor-broken —
    a materially different, much less severe threat model, never conflated
    with "quantum-safe"); `alg=none` is flagged as **unsigned**, its own
    distinct problem, never silently scored as safe or unknown
  - **Code-signing certificates** — classifies an X.509 certificate the
    caller already extracted from a signed artifact (PE/JAR/APK), reusing
    the same `X509Certificate` parsing path as TLS
  - TLS and SSH make a real active network connection, so both go through
    the exact same `evaluateScopeAuthorization` gate as starting a scan
    (`scan:create`) — no weaker path for "just reading a public key". JWT
    and code-signing inspect material the caller already possesses, so
    neither makes a network call and neither needs scope authorization
- **PQC classification** (`src/quantum/pqcClassification.js`, data-driven,
  `PQC_CLASSIFICATION_VERSION` stamped onto every finding it produces) —
  RSA/DSA/ECDSA/ECDH/EdDSA/X25519 marked quantum-vulnerable (broken by
  Shor's algorithm on a sufficiently large fault-tolerant quantum computer
  — a statement about the algorithm's math, not a claim such a machine
  exists); ML-KEM/ML-DSA/SLH-DSA marked quantum-safe, cited by NIST
  standard number (FIPS 203/204/205) rather than a vendor product name. An
  algorithm this table doesn't recognize is classified `quantumVulnerable:
  null` (UNKNOWN) — **never** silently reported as safe
- **Crypto Inventory** (`crypto_findings` table, `GET
  /api/v1/crypto/inventory`) — one row per real discovery, optionally
  linked to an `assets` row
- **CBOM** (`src/services/cbom.js`, `GET /api/v1/crypto/cbom`) —
  Asset → Algorithm → Key → Certificate → Protocol, built only from what
  Crypto Discovery actually observed
- **PQC Migration Readiness** (`src/services/pqcReadiness.js`, `GET
  /api/v1/crypto/readiness`) — a readiness percentage over *classified*
  findings only (UNKNOWN findings are excluded from the denominator and
  reported separately, never silently counted as safe); `readinessScore`
  is `null`, not a fabricated number, when there's no inventory yet. A
  migration roadmap ranks vulnerable findings by a documented heuristic
  (asset criticality + cert-expiry urgency + internet exposure) — stated
  in code and here as a relative-ordering aid, not a precise cost model
- **Harvest-Now-Decrypt-Later** flag on high/critical-criticality
  vulnerable findings: labeled `FUTURE_CONFIDENTIALITY_EXPOSURE` with an
  explicit "not a claim that the data is decryptable today" note, and its
  criticality-as-proxy basis stated plainly since BCI has no direct
  data-retention signal from a bare TLS probe
- **Quantum Compute Gateway convergence with ANATOLIA-Q** (IMPLEMENTED,
  read-only today): the long-term target architecture has both
  ANATOLIA-Q and BCI routing through one shared Quantum Compute Gateway.
  Reaching that safely — with zero changes to ANATOLIA-Q's own quantum
  code — turns out to need no new BCI code at all: a gateway session
  (`POST /api/v1/gateway/session`, M14) already carries normal role
  permissions, so ANATOLIA-Q can already call `GET /api/v1/quantum/*`
  through the exact same trusted session this repo's gateway integration
  already tests, rather than a second parallel trust mechanism. Verified
  directly: a gateway-issued session reading BCI's provider health and
  quantum policy (`test/gateway.test.js`). ANATOLIA-Q does not yet call
  this in its own code — that adoption, and any two-way flow (BCI
  submitting a workload through ANATOLIA-Q's quantum stack) remain
  PLANNED, deliberately outside this pass's scope given the explicit
  instruction to never risk ANATOLIA-Q's own working quantum behavior
- A Quantum & PQC page exists in `bci/ui/` (see below) covering
  everything above — including a protocol selector (TLS/SSH) and a JWT
  algorithm decoder — IMPLEMENTED end to end

20 new tests (classification table incl. fail-closed/unknown-algorithm
cases, real-TLS-handshake discovery against two live local servers, CBOM,
readiness scoring and prioritization, harvest-now-decrypt-later, and API
RBAC/cross-tenant isolation).

### Security Graph Optimizer (IMPLEMENTED)

Defensive graph analysis on top of the existing Security Graph (M10) —
read-only ranking/recommendation, never automatic exploitation and never a
graph mutation.

- **Attack-Path Prioritization** (`src/services/securityGraphOptimizer.js#computeAttackPathPriorities`,
  `GET /api/v1/graph/attack-paths`) — for every real `AFFECTED_BY` edge
  (a CVE actually correlated to an asset, M7), a real BFS over the graph's
  structural edges (reusing the same traversal `findReachableAssets`
  already uses) finds every asset reachable from a compromise there, and
  how many of those are CRITICAL/HIGH criticality. `priorityScore` is the
  finding's existing risk score weighted by that critical blast radius —
  a documented heuristic, not a calibrated probability, held to the same
  honesty bar as the M9 Risk Score itself
- **Patch Ordering** (`#computePatchOrder`, `GET /api/v1/graph/patch-order`)
  — the same analysis as a ranked list with a plain-language reason per
  item ("reachable... to N critical/high-criticality asset(s)") instead of
  a bare score
- **Defensive Control Placement** (`#identifyDefensiveControlPlacements`,
  `GET /api/v1/graph/defensive-controls`) — a path-centrality heuristic:
  for every vulnerable entry point, reconstructs the real shortest path
  (BFS with parent-pointers) to every reachable critical/high asset, and
  tallies which intermediate nodes those paths actually pass through. A
  node several real attack paths converge on is a candidate point for one
  control (segmentation, monitoring, WAF) to protect several paths at
  once — never presented as sufficient on its own, and a vulnerable entry
  point or the critical destination itself is never proposed as its own
  "placement" (verified directly: a graph with only a direct edge and no
  intermediate hop returns an empty placement list)
- Budget-constrained remediation allocation (spec section 9's fourth item)
  already existed from the prior milestone — `services/remediationOptimizer.js`
  — and is unchanged here

14 new tests (priority ranking incl. a zero-critical-blast-radius control
case, patch-order reason text, converging-path centrality scoring, and the
never-propose-an-endpoint guarantee), all read-only endpoints gated at
`finding:view`.

**260/260 total BCI tests green** (an earlier, isolated `engines.test.js`
timeout under system load was confirmed as pre-existing flakiness by
rerunning that file alone, clean both before and after this change), no
ANATOLIA-Q files touched.

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
