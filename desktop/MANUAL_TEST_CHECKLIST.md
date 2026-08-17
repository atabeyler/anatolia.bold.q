# ANATOLIA-Q Desktop — Manual Test Checklist (real Windows machine)

Everything below needs an actual Windows machine (or a Windows CI runner)
with network control — none of it can be verified inside a Linux sandbox
with no display and no live deployment. Run these once before treating the
desktop build as production-ready.

## 0. Build & install

- [ ] On the target Windows machine (or CI): `npm install`, then
      `npx electron-rebuild -f -w better-sqlite3`, then `npm run dist:win`.
- [ ] Confirm `release/ANATOLIA-Q-Setup-<version>.exe` was produced.
- [ ] Run the installer on a **clean** machine/VM (no prior Node/dev tools
      installed) — this is the real test of item 6: does the native
      `better-sqlite3` module actually load once packaged, with no
      compiler/toolchain present on the target machine?
- [ ] Confirm: Start Menu shortcut exists, Desktop shortcut exists, the app
      launches, the app icon shows correctly, an uninstaller is listed in
      "Add or remove programs" and actually removes the app.

## 1. Online login → device authorization

- [ ] Launch the installed app with internet connected.
- [ ] Log in with a real account (through the normal approval flow).
- [ ] Confirm in the backend (`devices` table or `GET /api/devices` while
      authenticated as that user) that a new `AQ-WIN-XXXXXXXX` row appears,
      `revoked_at` is null.

## 2. Offline login (spec test I) — the top-priority item

- [ ] With the same account still logged in from step 1, fully quit the app.
- [ ] Disconnect the network (turn off Wi-Fi/unplug — not just close the
      app).
- [ ] Relaunch the app. The Q CLOUD/Q LOCAL badge should show **Q LOCAL**.
- [ ] Log out, then log back in **with the same user code and password**,
      still offline. This must succeed (verified locally against the
      bcrypt hash cached at step 1 — see `desktop/auth/session.js`).
- [ ] Try logging in with a **wrong password**, still offline — must be
      rejected.
- [ ] On a second, never-before-used machine/VM (or after deleting
      `%APPDATA%/ANATOLIA-Q`), try offline login **without ever having
      logged in online first** — must be rejected (this is the device
      authorization gate; confirm the error message is the "cihaz
      yetkilendirilmemiş" one, not a generic failure).

## 3. Offline create → persists across restart (spec test B)

- [ ] While offline (from step 2), create a new report from the desktop app.
- [ ] Fully quit the app (not just close the window) and relaunch it,
      still offline.
- [ ] Confirm the report is still there in the history list.

## 4. Offline → online automatic sync (spec test C)

- [ ] With the offline-created report from step 3 still pending sync,
      reconnect the network.
- [ ] Without touching anything, confirm within ~30s the status badge
      moves Q LOCAL → SYNC → Q CLOUD, and the report is now visible from
      the **web app** (a different browser/session, same account).

## 5. Web edit → desktop pull (spec test D)

- [ ] From the web app, edit or create a report on the same account.
- [ ] On the desktop app (online), wait for the next sync pass (or use the
      app menu's "Şimdi Senkronize Et") and confirm the change appears.

## 6. Two-device conflict (spec test E)

- [ ] Install/run the desktop app on **two** machines (or two separate
      `%APPDATA%` profiles) logged into the same account, both online-
      authorized per step 1.
- [ ] Disconnect both from the network.
- [ ] Edit the *same* report differently on each.
- [ ] Reconnect both. Confirm the conflict resolution modal (Yerel
      sürümü kullan / Bulut sürümünü kullan) appears on whichever device's
      edit lost the race, and that picking a side actually resolves it
      (the other device's next pull reflects the choice).

## 7. Duplicate operation (spec test G)

- [ ] While a sync is in flight, kill the app process (Task Manager) mid-
      sync, relaunch, and let it retry. Confirm no duplicate report shows
      up in the history (the operation_id idempotency ledger should have
      prevented a double-apply — see `server/src/routes/sync.js`).

## 8. User isolation (spec test H)

- [ ] Log in as a second, different account on the same desktop install.
- [ ] Confirm the first account's reports are not visible or reachable —
      including via the local AI's find/summarize (should return nothing
      for the first account's data).

## 9. Local AI without network (spec test J)

- [ ] Fully offline, ask the local AI to find/summarize/compare existing
      reports and confirm it answers without a crash or hang, and that a
      request that *would* require the cloud (generating a brand new
      analysis) is clearly reported as requiring a connection rather than
      silently failing.

## 10. Code signing (separate from all of the above)

- [ ] With `CSC_LINK`/`CSC_KEY_PASSWORD` set (the self-signed cert — see
      desktop/README.md's "Code signing" section), confirm `npm run
      dist:win` actually signs the `.exe` (Windows: right-click →
      Properties → Digital Signatures tab should show the "Bold Askeri
      Teknoloji ve Savunma Sanayi A.Ş." certificate).
- [ ] On a machine where the public `.cer` has **not** been imported: confirm
      SmartScreen still shows "Unknown Publisher" (expected — a self-signed
      cert doesn't grant public trust).
- [ ] On a machine where an admin imported `anatolia-q-codesign-public.cer`
      into both Trusted Root Certification Authorities and Trusted
      Publishers (per desktop/README.md): confirm SmartScreen no longer
      warns and the installer runs cleanly.
- [ ] If/when a CA-trusted certificate (or Microsoft Trusted Signing)
      replaces the self-signed one, re-run this whole section and confirm
      no GPO step is needed anymore.
