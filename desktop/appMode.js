import fs from 'node:fs';
import path from 'node:path';

// Persists { mode: 'auto' | 'offline' } -- mirrors auth/deviceId.js's exact
// read/write pattern. There is no generic settings store (no electron-store
// dependency) in this repo, so a small dedicated JSON file is the minimal
// addition for the one setting Offline Mode needs to survive a restart.
const MODE_FILE_NAME = 'app-mode.json';

// A forgetDevice() server-side revoke that couldn't be sent while Offline
// Mode was on (main.js's auth:forgetDevice handler -- see session.js's
// forgetDevice({ allowNetwork }) and its pendingServerRevoke return value).
// Kept in its own sibling file rather than folded into app-mode.json so a
// missing/corrupt revoke marker can never affect reading the app mode
// itself.
const PENDING_REVOKE_FILE_NAME = 'pending-device-revoke.json';

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Corrupt file -- treat as absent rather than crash the app over a
    // small local settings cache (same defensive pattern as deviceId.js).
    return null;
  }
}

function writeJsonSafe(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// createAppModeController -- the renderer -> main IPC bridge backing for
// the desktop "Offline Mode" toggle (Settings > Bağlantı). A small
// testable factory mirroring connectivity.js's createConnectivityMonitor
// style: every Electron-only or process-wide dependency (broadcasting to
// the renderer, starting/stopping main.js's sync & update timers, running
// a sync pass) is injected rather than imported, so this is unit-testable
// without a real Electron process.
export function createAppModeController({
  userDataDir,
  connectivity,
  performSync,
  getNeedsReauth,
  startTimers,
  stopTimers,
  sendReauthRequired = () => {},
  broadcastConnectivity = () => {},
  apiBaseUrl,
  fetchImpl = fetch,
}) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const modeFile = path.join(userDataDir, MODE_FILE_NAME);
  const revokeFile = path.join(userDataDir, PENDING_REVOKE_FILE_NAME);

  let mode = readJsonSafe(modeFile)?.mode === 'offline' ? 'offline' : 'auto';

  function get() {
    return mode;
  }

  function isOffline() {
    return mode === 'offline';
  }

  // Called from main.js's auth:forgetDevice handler when
  // forgetDevice({ allowNetwork: false }) hands back a truthy
  // pendingServerRevoke -- persisted to disk (not just kept in memory) so
  // it survives an app restart that happens before Offline Mode is ever
  // turned back off.
  function setPendingRevoke(revoke) {
    if (revoke) writeJsonSafe(revokeFile, revoke);
  }

  // Best-effort, fire-once: mirrors auth/session.js's own forgetDevice()
  // DELETE call exactly (same method/header shape). This is not a
  // guaranteed-delivery queue -- the marker is cleared regardless of
  // outcome, matching forgetDevice()'s own fire-and-forget contract for
  // the online case; a failed attempt here just leaves the device
  // server-side authorized until the user forgets it again.
  async function flushPendingRevoke() {
    const pending = readJsonSafe(revokeFile);
    if (!pending?.deviceId || !pending?.jwt || !apiBaseUrl) return;
    try {
      await fetchImpl(`${apiBaseUrl}/api/devices/${pending.deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${pending.jwt}` },
      });
    } catch {
      // Network blip -- ignored, best-effort as documented above.
    } finally {
      try { fs.rmSync(revokeFile, { force: true }); } catch {}
    }
  }

  // The reconciliation sequence for coming back to 'auto': resume
  // connectivity polling, check once immediately (rather than waiting up
  // to intervalMs for the next tick), bail out to a reauth prompt if the
  // cached session has expired (matching performSync()'s own check),
  // otherwise sync once, restart the periodic timers, push the fresh
  // connectivity state to the renderer, then flush any device-revoke that
  // piled up while offline.
  async function reconcileAuto() {
    connectivity.start();
    await connectivity.checkOnce();
    if (getNeedsReauth()) {
      sendReauthRequired();
    } else {
      await performSync().catch(() => {});
    }
    startTimers();
    broadcastConnectivity(connectivity.getState());
    await flushPendingRevoke();
  }

  async function set(next) {
    if (next !== 'auto' && next !== 'offline') return mode;
    mode = next;
    writeJsonSafe(modeFile, { mode });
    if (next === 'offline') {
      // Belt-and-suspenders alongside performSync()'s own top-of-function
      // guard (main.js) -- stops the timers/polling that would otherwise
      // call it again within minutes.
      stopTimers();
      return mode;
    }
    try {
      await reconcileAuto();
    } catch {
      // Best-effort -- the mode itself is already persisted as 'auto'
      // above regardless of whether this one reconciliation pass fully
      // succeeded; the next periodic sync/connectivity tick gets another
      // attempt.
    }
    return mode;
  }

  return { get, set, isOffline, setPendingRevoke };
}
