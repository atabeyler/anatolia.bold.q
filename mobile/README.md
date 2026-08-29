# ANATOLIA-Q Android (Capacitor)

A Capacitor shell around the existing `client/` React app, reusing the exact
same offline-first sync architecture, device auth, and local AI built for
the Windows desktop app — ported to Capacitor's async, Promise-based native
APIs. The web app and the desktop app are both completely unaffected; this
directory only ever consumes the already-built `client/dist`.

**Distribution: sideloaded APK only, never Google Play.** This mirrors the
desktop app's closed institutional distribution model (self-signed
Authenticode cert, no Microsoft Store). There is no Play Store listing, no
Play App Signing enrollment, and the release workflow never touches the Play
Console — it only publishes the signed APK to this repo's GitHub Releases.

## Architecture

```
Capacitor WebView (no separate "main process" — unlike Electron, native
plugins are called directly from the same JS context as the web app)
┌─────────────────────────────────────────────────────────────────┐
│ client/ React app (unchanged) + client/src/services/mobileBridge.js │
│  window.anatoliaMobile.{isMobileApp, cloudUrl, platform}          │
│                                                                     │
│ client/src/mobile/db/       — @capacitor-community/sqlite (async), │
│  migrations identical to desktop/db/migrations (duplicated, not    │
│  shared — Vite can't resolve cross-package files)                  │
│                                                                     │
│ client/src/mobile/sync/     — queue, engine, conflict: same         │
│  idempotent-push / cursor-pull / optimistic-concurrency protocol   │
│  as desktop/sync/, ported to async/await                           │
│                                                                     │
│ client/src/mobile/auth/     — device id (AQ-AND-XXXXXXXX), bcrypt   │
│  offline-login, @aparajita/capacitor-secure-storage (Android        │
│  Keystore-backed, not localStorage)                                │
│                                                                     │
│ client/src/mobile/localAI/  — same offline extractive search/       │
│  summarize/compare engine as desktop, ported to async               │
└──────────────────────────────┬──────────────────────────────────┘
                                │ HTTPS, same /api/sync, /api/devices,
                                │ /api/analysis endpoints the desktop
                                │ app and the web app use
                                ▼
                    Backend (server/, unchanged — see desktop/README.md
                    for the sync protocol, which is shared verbatim)
```

`client/src/services/nativeBridge.js` picks `desktopBridge.js` or
`mobileBridge.js` based on which platform is actually running, so UI
components (`LoginPage.jsx`, `HistoryView.jsx`, the sync-status badge, the
conflict-resolution modal) never branch on platform themselves — they just
call `isNativeApp` / `nativeAuth` / `nativeSync` / `nativeAI` /
`nativeConnectivity`.

**ÇIKIŞ YAP vs BU CİHAZI UNUT.** `client/src/mobile/auth/session.js`
exposes two distinct sign-out operations, not one. **ÇIKIŞ YAP**
(`logoutSession()`) clears only the active session (the cached JWT) — this
device's offline-login authorization is preserved, so the same account can
offline-login again on this device immediately, without a fresh online
round-trip. **BU CİHAZI UNUT** (`forgetDevice()`, Settings → Security)
fully removes this device's offline-login credential and authorization
(`device_meta.last_authorized_user_id`/`last_authorized_at` cleared, along
with the offline-lockout counters, and the secure store wiped) and
best-effort revokes the device server-side (`DELETE /api/devices/
:deviceId`) — a fresh online login is required before offline login works
again on this device.

**ÇEVRİMDIŞI MOD.** A separate, user-selected app-wide preference (Settings
→ Bağlantı, `client/src/services/appModePreference.js`), completely
independent of the login/device-authorization state above -- neither
`client/src/mobile/auth/session.js` nor this preference module ever imports
the other. Switching it on suspends cloud connectivity, live sync, and every
online-only service (Socket.IO, the update check, the weather widget, cloud
AI routing, passkey management) while preserving local data and the pending
sync queue, regardless of the device's actual reachability. Switching back
to Otomatik reconnects the socket if needed and (once
`nativeAuth.needsReauth()` says a fresh login isn't required) flushes the
pending sync queue via the existing `nativeSync.forceSync()` call -- no new
sync/socket mechanism, just gating the existing ones at their call sites.

## Why this needed a cross-origin fix

Capacitor's WebView loads the app from `capacitor://localhost` (or
`https://localhost` on some configs), which is **not** the deployed backend
origin — the same problem the Electron desktop app has with its local
static server (see `desktop/README.md`'s "local HTTP server" section).
`client/src/services/api.js`'s `baseFor()` resolves the real API origin
dynamically from `window.anatoliaMobile.cloudUrl` (or
`window.anatoliaDesktop.cloudUrl` on desktop) instead of assuming
same-origin, and `server/src/index.js`'s CORS allowlist explicitly includes
Capacitor's native origins alongside the desktop's fixed static-server
origin. Override the default cloud URL at build time with
`VITE_MOBILE_CLOUD_URL` if pointing at a self-hosted/staging backend.

## Setup

```bash
cd client && npm ci && npm run build   # produces client/dist, which mobile/ wraps
cd ../mobile && npm ci
npm run sync                           # cap sync android — copies client/dist in
npm run open                           # opens the project in Android Studio
```

Requires the Android SDK (`ANDROID_HOME`/`ANDROID_SDK_ROOT`) with
`platform-tools`, `platforms;android-36`, and `build-tools;36.0.0` installed,
and a JDK (17+; CI uses Temurin 21).

```bash
cd android && ./gradlew assembleDebug     # unsigned debug APK, for testing
                ./gradlew assembleRelease  # release APK — signed if
                                           # keystore.properties exists (see below)
```

## Signing

Same free, self-signed approach as the desktop app's Authenticode
certificate: a self-signed Android keystore, generated once, used to sign
every release so Android will accept it as an update to an existing install
(Android requires all versions of an app to share one signing key — unlike
Windows, self-signed vs. CA-issued makes no UX difference for a sideloaded
APK, so there is no SmartScreen-equivalent warning to work around).

- `mobile/android/keystore.properties.example` is the committed template.
  Copy it to `mobile/android/keystore.properties` (gitignored, never
  committed — see `mobile/android/.gitignore`) and fill in the real
  passwords to sign locally.
- `app/build.gradle` reads `keystore.properties` if present and signs the
  `release` build type; if the file is absent, `assembleRelease` still
  succeeds and produces an **unsigned** APK.
- CI (`.github/workflows/android-release.yml`) reconstructs
  `keystore.properties` from four repository secrets at build time —
  `ANDROID_KEYSTORE_BASE64` (the `.jks`, base64-encoded),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` —
  and never commits the keystore itself.

The actual keystore and its password were generated once and delivered
directly to the project owner (never committed to the repository) — see the
delivered README for the exact secret values and the fingerprint to verify
against.

## Releases

`.github/workflows/android-release.yml` fires automatically on every push to
`main` — unfiltered by path, since every commit bumps the app version via
`scripts/bump-version.js` and so is a distinct release — or via a manual
`workflow_dispatch`: it builds `client/dist`, syncs it into the Android
project, builds and signs the release APK, and uploads it to a GitHub
Release.

The APK is attached to the **same versioned release as the Windows
installer** — tag `v<version>`, read from the root `package.json` (kept in
sync across `package.json`/`client`/`server` by `scripts/bump-version.js`
on every commit) — rather than a separate tag, so both
installers for a given app version live in one place. Whichever release
workflow (this one, or `desktop-release.yml`) runs first for a given
version creates that release (published immediately, not a draft — a
GitHub draft release can't be found by tag lookup, which used to cause the
two workflows to race and duplicate); the other finds it by tag and adds
its asset alongside. The uploaded file is named `ANATOLIA-Q-<version>.apk`.

Distribution from there is direct download + manual "Install from unknown
sources" on each device (or an MDM push) — there is no store listing. The
app does check for and prompt about newer APK releases: `UpdateBanner.jsx`
polls this server's own `/api/version/latest` (never GitHub directly), and
approving downloads the APK itself and hands it straight to the system
package installer via a `FileProvider` intent (`mobileUpdate.approve` in
`client/src/services/mobileBridge.js`, using `@capacitor/filesystem` +
`@capacitor-community/file-opener`) — not a Play-Store-style silent
auto-install, but it skips routing the download through Chrome, which
otherwise flags sideloaded `.apk` downloads with its own warning on top of
Android's own unknown-sources install prompt.

## Testing

`client/src/mobile/**/*.test.js` — 59 tests, run via the client's normal
`npm test` (they're colocated with the rest of `client/src` so they run in
the same Vitest suite). CI has no real device/emulator, so
native-plugin-dependent code (`db/index.js`, `auth/secureStore.js`) is
tested through dependency injection: a fake Capacitor SQLite connection
backed by a **real** in-memory `better-sqlite3` database
(`client/src/mobile/testHelpers.js`), not a hand-rolled fake that
pattern-matches SQL strings — so the tests exercise real SQL against a real
engine, just not the real native bridge. `better-sqlite3` is a client
`devDependency` for this reason only; it is never bundled into the shipped
APK.

What the automated suite can't cover and needs manual real-device
verification instead (same caveat as the desktop app's
`MANUAL_TEST_CHECKLIST.md`): install-from-APK flow on a physical/emulated
Android device, offline login after a real app kill/relaunch, cross-device
conflict resolution against the live backend, and Android Keystore-backed
secure storage behavior across an OS-level app data wipe.
