import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// Checks for and downloads app updates via this app's own server
// (server/src/routes/version.js) instead of talking to GitHub's API
// directly from an installed client -- an institutional deployment
// constraint (see that route's comment). Only the actual installer
// *download* below touches a GitHub Releases asset URL directly, and only
// once the user has explicitly approved the update in the renderer.
//
// Replaces the previous electron-updater-based flow (checkForUpdatesAndNotify),
// which resolved the update via GitHub's own API/latest.yml on every launch.

function isNewer(latestVersion, currentVersion) {
  const a = latestVersion.split('.').map(Number);
  const b = currentVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(apiBaseUrl, currentVersion, fetchImpl = fetch) {
  const res = await fetchImpl(`${apiBaseUrl}/api/version/latest`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Sürüm kontrolü başarısız (HTTP ${res.status})`);
  const info = await res.json();
  const exe = info.assets?.desktopExe;
  if (!info.version || !exe?.url || !isNewer(info.version, currentVersion)) {
    return { available: false };
  }
  return { available: true, version: info.version, notes: info.notes, url: exe.url, size: exe.size };
}

// Streams the installer to disk with progress callbacks -- the file itself
// still comes straight from GitHub's release asset URL (approved scope:
// only the version-check metadata is proxied through our own server, not
// the multi-megabyte binary).
export async function downloadUpdate(url, destDir, onProgress, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`İndirme başarısız (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const destPath = path.join(destDir, path.basename(new URL(url).pathname));
  let received = 0;

  await fs.promises.mkdir(destDir, { recursive: true });
  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    received += chunk.length;
    onProgress?.({ received, total });
  });
  await pipeline(nodeStream, fs.createWriteStream(destPath));
  return destPath;
}

export const _internal = { isNewer };
