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
authorized online at least once. The session (JWT) itself is encrypted at
rest via Electron's `safeStorage` (`auth/secureStore.js`, DPAPI on Windows)
— never `localStorage`, and never reachable from the renderer at all
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
this with). Code signing is left unconfigured (`CSC_LINK`/`CSC_KEY_PASSWORD`
env-driven) rather than faked; `electron-updater` is wired in `main.js` but
no-ops until a `publish` feed is configured.

```bash
npm run dist:win
```

Building the NSIS installer's icon/version-resource step requires `wine` on
Linux (a known electron-builder limitation, unrelated to code signing) — it
is not needed at all when building on an actual Windows machine or a
Windows CI runner.

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
