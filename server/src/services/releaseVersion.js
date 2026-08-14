// Looks up the latest published GitHub Release so the Android/desktop
// clients never have to talk to GitHub at all -- an institutional
// deployment constraint, client devices only ever talk to this server.
// Both the version-check metadata *and* the actual installer/APK download
// are proxied through here (see routes/version.js's /download/:platform,
// which streams the browser_download_url this returns) -- the client
// never sees a github.com address anywhere in the update flow.
const REPO = 'atabeyler/anatolia.bold.q';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes -- avoids hitting GitHub's API on every client check

let cache = null; // { fetchedAt, data }

function pickAsset(assets, suffix) {
  const asset = (assets || []).find((a) => a.name?.endsWith(suffix));
  return asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size } : null;
}

async function fetchLatestRelease() {
  const r = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'anatolia-q-server' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`GitHub releases lookup failed (HTTP ${r.status})`);
  const release = await r.json();

  return {
    version: (release.tag_name || '').replace(/^v/, ''),
    publishedAt: release.published_at,
    notes: release.body || '',
    assets: {
      androidApk: pickAsset(release.assets, '.apk'),
      desktopExe: pickAsset(release.assets, '.exe'),
    },
  };
}

export async function getLatestVersionInfo() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  const data = await fetchLatestRelease();
  cache = { fetchedAt: Date.now(), data };
  return data;
}

export const _internal = { pickAsset };
