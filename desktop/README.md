# ANATOLIA-Q Desktop (Electron)

A production Electron shell around the existing `client/` React app, adding
an offline-first SQLite cache and a real bidirectional sync engine against
the backend's Postgres database. The web app is completely unaffected —
this directory only ever *loads* the already-built `client/dist`, never
modifies it.

## Architecture

```
Electron main process                    Backend (server/, unchanged for web)
┌────────────────────────────┐            ┌───────────────────────────────┐
│ main.js — window, security, │  HTTPS     │ routes/sync.js                │
│ single-instance, menu       │───────────▶│  POST /api/sync/push          │
│                              │            │  GET  /api/sync/pull          │
│ preload.js — contextBridge  │            │  GET  /api/sync/status        │
│  → window.anatoliaDesktop   │            │ routes/devices.js             │
│                              │            │  POST /api/auth/devices/... (mounted at /api/devices) │
│ db/ — better-sqlite3, WAL,  │            │ analyses table + sync         │
│  migrations                 │            │  metadata columns, devices,   │
│                              │            │  sync_operations tables       │
│ sync/ — queue, engine,      │            └───────────────────────────────┘
│  conflict resolution        │
│                              │
│ auth/ — device id,          │
│  safeStorage session,       │
│  offline-login gate         │
│                              │
│ localAI/ — offline           │
│  find/summarize/compare      │
│                              │
│ connectivity.js — cloud/     │
│  sync/local tri-state        │
└──────────────┬───────────────┘
               │ serves client/dist over a local HTTP server (not file://)
               ▼
      client/ React app (unchanged), + client/src/services/desktopBridge.js
      (a no-op on the web build — window.anatoliaDesktop is undefined there)
```

## Why a local HTTP server instead of `file://`

`client/vite.config.js` has no `base` override, so the build emits
root-relative asset URLs (`/assets/...`). Those resolve correctly against an
`http://` origin (exactly like the deployed web app) but not against
`file://`, which has no root to be relative to. `desktop/staticServer.js`
serves the built SPA on `127.0.0.1` at a random port instead, so the web
build config never has to change to accommodate Electron.

## Scope: `analyses` is the synced entity

The offline/sync work is generic (entity-type-aware — see `sync/queue.js`
and `routes/sync.js`), but only the `analyses` table (reports) is wired
through it end-to-end in this pass. That matches what the desktop spec
actually needs: browsing/searching past reports offline, editing/deleting
them, and having those changes reconcile across devices. Live features
(chat, presence, video) stay Socket.IO-only — a single-user offline queue
isn't the right model for those.

## Sync protocol

Every local write (`db/analysesRepo.js`) is applied to SQLite immediately
and queues a durable row in `sync_queue` with a client-generated
`operation_id` (UUID). `sync/engine.js`:

1. **Push** — sends due queued operations to `POST /api/sync/push`, one op
   per entity per pass (so a create always lands before a later update to
   the same record). The server is idempotent per `operation_id` (a retried
   push replays the stored result instead of double-applying) and detects
   conflicts via optimistic concurrency: each op carries the `baseVersion`
   it was edited against, and the server rejects (rather than overwrites) a
   stale write.
2. **Pull** — fetches everything changed since a locally persisted cursor
   (`sync_state.pull_cursor`, tracks the server's monotonic
   `analyses.sync_revision`), applying tombstones for soft-deletes. A record
   with a local edit still in flight is never overwritten by a pull — it
   waits for that push to resolve (success or conflict) first.
3. **Conflicts** — when the server rejects a stale `baseVersion`, both sides
   are recorded in the local `conflicts` table (never silently discarded);
   `sync/conflict.js` exposes `resolveConflict(conflictId, 'kept_local' |
   'kept_server')` to settle it, re-queuing the local edit against the
   now-known server version or overwriting the local copy, respectively.
   `client/src/components/DesktopConflictModal.jsx` is the actual user-
   facing side of this: it polls `sync.listConflicts()` and shows both
   versions side by side with "Yerel sürümü kullan" / "Bulut sürümünü
   kullan" buttons.

Retries use exponential backoff (`sync/queue.js`, capped at 30 minutes,
giving up after 8 attempts but always keeping the row and its `last_error`
on disk — never silently dropped). Because state lives entirely in SQLite,
a sync interrupted by the app being closed simply resumes from the same
queue/cursor on next launch.

## Auth & device identity

Each install gets a unique `AQ-WIN-XXXXXXXX` id (`auth/deviceId.js`),
persisted once. `auth/session.js` ties an online login to that device via
`POST /api/devices/register` (requires a fresh JWT) — this is the "online
authorization" step that later gates offline login: `isOfflineLoginAllowed`
only returns true for a `(deviceId, userCode)` pair that has actually
authorized online at least once.

**Offline login** is a real login, not a silently-resumed session: the same
LoginPage form is shown, and `verifyOfflineLogin(userCode, password)`
checks the entered password against a **bcrypt hash** (cost 10, matching
the server's own `auth_users` convention) cached locally at the last
successful online login — the plaintext password is never written to disk
or to `localStorage` at any point (see `client/src/pages/LoginPage.jsx`,
which also no longer persists a remembered password for the web app for
the same reason). `client/src/pages/LoginPage.jsx` takes the offline path
either when the connectivity monitor already reports `local`, or when the
online login request itself fails with a genuine network error (not a
credential rejection from a reachable server).

The whole cached session object (JWT + password hash) is encrypted at rest
via Electron's `safeStorage` (`auth/secureStore.js`, DPAPI on Windows) —
never `localStorage`, and never reachable from the renderer at all
(`contextIsolation: true`, `nodeIntegration: false`).

## Local AI

`localAI/offlineExtractive.js` is a real, fully offline backend — keyword
search with Turkish relative-date parsing ("geçen ayki raporlarımı bul"),
extractive summarization, and bag-of-words comparison — running directly
against the local SQLite `analyses` table, no model download and no network
call. It deliberately does **not** try to replace cloud AI: generating a new
analysis (LLM + optionally the quantum kernel) stays cloud-only via the
existing `/api/analysis` endpoints, exactly as it works on the web today.
`localAI/provider.js` never throws past its boundary — a broken/unavailable
backend degrades to a reported capability flag, not a crash.

## Packaging

Windows packaging is configured in the root `package.json`'s `build` key
(electron-builder, NSIS target, Start Menu + Desktop shortcut, uninstaller).
`desktop/build/icon.ico` is generated by `desktop/build/generate-icon.js`
(a from-scratch PNG/ICO encoder — no image tooling was available to build
this with).

```bash
npm run dist:win        # local build, no publish
npm run release:win     # build + upload to the configured GitHub Releases target
```

## Code signing

electron-builder signs automatically whenever `CSC_LINK` (a path, URL, or
base64 data blob of a `.pfx`) and `CSC_KEY_PASSWORD` are set in the
environment, and silently builds unsigned when they're not — no code
change needed either way.

A self-signed Authenticode certificate (5-year validity, proper
`codeSigning` EKU) was generated for this project as a free option, since a
publicly CA-trusted certificate is a recurring paid cost. **A self-signed
certificate does not remove the Windows SmartScreen "Unknown Publisher"
warning for the general public** — it only works on machines where an
administrator has explicitly registered the certificate as trusted. For a
closed institutional deployment (this app's actual distribution model:
pre-provisioned accounts on organization-managed machines) that's a
one-time IT action rather than a blocker:

1. Import `anatolia-q-codesign-public.cer` (the certificate's public half —
   safe to distribute, contains no private key) on each target machine, or
   push it fleet-wide via Group Policy, into **both**:
   - `Trusted Root Certification Authorities` (so Windows can validate the
     self-signed chain at all), and
   - `Trusted Publishers` (so it's actually accepted for code execution,
     not just chain-valid).
2. Set the two GitHub Actions secrets so `desktop-release.yml` signs
   automatically on every release: **Settings → Secrets and variables →
   Actions** → add `CSC_LINK` (the `.pfx`, base64-encoded) and
   `CSC_KEY_PASSWORD`.
3. For a local `npm run dist:win`, export the same two values as
   environment variables instead.

If broader (non-institutional) distribution is ever needed, a CA-trusted
certificate removes the SmartScreen warning for every machine without any
GPO step — either a traditional Authenticode cert (~$200-500/year,
DigiCert/Sectigo/SSL.com) or Microsoft Trusted Signing (~$10/month, instant
Microsoft-backed trust, requires a verified business identity via Azure).
Swapping to one later is the same two environment variables, no other
change.

Building the NSIS installer's icon/version-resource step requires `wine` on
Linux (a known electron-builder limitation, unrelated to code signing) — it
is not needed at all when building on an actual Windows machine or a
Windows CI runner, which is exactly what the release workflow below uses.

## Releases & auto-update

`electron-updater` (`main.js`) is wired to check GitHub Releases on every
launch (`build.publish` in `package.json` — provider `github`, this repo).

`.github/workflows/desktop-release.yml` fires automatically on every push to
`main` — unfiltered by path, since every commit bumps the app version via
`scripts/bump-version.js` and so is a distinct release — as well as on a
push of a `desktop-v*` tag, or a manual `workflow_dispatch`. It builds on an
actual `windows-latest` GitHub-hosted runner (no wine needed there) and
uploads the installer + `latest.yml` to a GitHub Release via the
Actions-provided `GITHUB_TOKEN` — no manually-managed secret required. Once
a release exists, every previously-installed copy of the app picks it up
automatically the next time it's online. Cutting a release explicitly (e.g.
to rebuild an older commit) still works the same way:

```bash
git tag desktop-v2.2.0
git push origin desktop-v2.2.0
```

`better-sqlite3` and `bcryptjs` are listed under `dependencies`, not
`devDependencies` — the packaged app needs both at runtime (native SQLite
addon and offline-password hashing respectively), and some CI pipelines run
`npm ci --omit=dev` before invoking electron-builder, which would silently
drop anything left in `devDependencies`.

See **[MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md)** for the
scenarios that can only be verified on a real Windows machine (offline
login, cross-device conflict resolution, a clean-machine installer run,
...) — none of those can be exercised inside a Linux sandbox with no
display and no live deployment.

## Native module ABI note

`better-sqlite3` is a native addon and must be built against whichever Node
ABI will load it — Electron's bundled Node for `npm run desktop` /
`desktop:dev`, or the system Node for `npm run test:desktop`. After `npm
install` it's built for the system Node, so tests work immediately. Running
`npx electron-rebuild -f -w better-sqlite3` switches it to Electron's ABI;
after that, plain-Node commands (`npm run test:desktop`) will fail to load
it until you run `npm rebuild better-sqlite3` to switch it back. `npm run
dist:win` doesn't have this problem — electron-builder rebuilds it for
Electron automatically as part of packaging, regardless of prior state.
