import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// Maps Electron's process.platform to the asset key /api/version/latest
// returns for that OS (see server/src/services/releaseVersion.js).
const ASSET_KEY_BY_PLATFORM = { win32: 'desktopWin', darwin: 'desktopMac', linux: 'desktopLinux' };

export async function checkForUpdate(apiBaseUrl, currentVersion, platform = process.platform, fetchImpl = fetch) {
  const res = await fetchImpl(`${apiBaseUrl}/api/version/latest`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Sürüm kontrolü başarısız (HTTP ${res.status})`);
  const info = await res.json();
  const assetKey = ASSET_KEY_BY_PLATFORM[platform];
  const asset = assetKey ? info.assets?.[assetKey] : null;
  if (!info.version || !asset?.url || !isNewer(info.version, currentVersion)) {
    return { available: false };
  }
  return { available: true, version: info.version, notes: info.notes, url: asset.url, name: asset.name, size: asset.size, sha256: asset.sha256 || null, platform };
}

const SHA256_RE = /^[0-9a-f]{64}$/i;

// Streams the installer to disk with progress callbacks -- both this
// request and the version check above go to this app's own server (see
// server/src/routes/version.js's /download/:platform), which itself
// proxies the bytes from GitHub. The client process never opens a
// connection to github.com at any point in the update flow.
//
// Fail-closed cryptographic integrity check (AQ-003): a size match alone
// only proves the download wasn't truncated, not that the bytes are the
// genuine installer -- a same-sized MITM'd or compromised asset would pass
// silently. The expected SHA-256 comes from GitHub's own asset `digest`
// field (see releaseVersion.js's extractSha256/pickAsset), never from the
// downloaded file itself, so a corrupted/substituted download can't also
// forge its own "expected" hash. checkForUpdate() (this module's only
// caller of downloadUpdate in practice, via main.js) always runs from an
// app.isPackaged build (see main.js's checkAndBroadcastUpdate guard), so
// there is no legitimate dev-mode case where expectedSha256 should be
// missing -- a missing or malformed value is treated the same as a
// mismatch: reject and delete, never install.
export async function downloadUpdate(url, fileName, destDir, onProgress, fetchImpl = fetch, expectedSize = null, expectedSha256 = null) {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`İndirme başarısız (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  // fileName comes from this app's own server (ultimately GitHub's asset
  // name) -- basename it before joining so a manipulated/unexpected name
  // (e.g. containing "../") can never write outside destDir.
  const safeName = path.basename(fileName);
  const destPath = path.join(destDir, safeName);
  let received = 0;

  await fs.promises.mkdir(destDir, { recursive: true });
  const hash = crypto.createHash('sha256');
  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    received += chunk.length;
    hash.update(chunk);
    onProgress?.({ received, total });
  });
  await pipeline(nodeStream, fs.createWriteStream(destPath));

  const expectedBytes = Number(expectedSize) || total;
  if (expectedBytes > 0 && received !== expectedBytes) {
    try { fs.unlinkSync(destPath); } catch { /* best-effort */ }
    throw new Error(`İndirilen dosya beklenen boyutta değil (${received}/${expectedBytes} bayt)`);
  }

  const actualSha256 = hash.digest('hex');
  if (!expectedSha256 || !SHA256_RE.test(expectedSha256)) {
    try { fs.unlinkSync(destPath); } catch { /* best-effort */ }
    throw new Error('Güncelleme dosyası için bütünlük doğrulaması (SHA-256) alınamadı — güvenlik nedeniyle kurulum reddedildi.');
  }
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    try { fs.unlinkSync(destPath); } catch { /* best-effort */ }
    throw new Error('İndirilen güncelleme dosyasının bütünlük doğrulaması (SHA-256) başarısız oldu — dosya bozulmuş veya değiştirilmiş olabilir, kurulum reddedildi.');
  }

  return destPath;
}

export const _internal = { isNewer };
