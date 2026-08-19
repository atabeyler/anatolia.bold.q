// Looks up the latest published GitHub Release so the Android/desktop
// clients never have to talk to GitHub at all -- an institutional
// deployment constraint, client devices only ever talk to this server.
// Both the version-check metadata *and* the actual installer/APK download
// are proxied through here (see routes/version.js's /download/:platform,
// which streams the browser_download_url this returns) -- the client
// never sees a github.com address anywhere in the update flow.
const REPO = 'atabeyler/anatolia.bold.q';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

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
  const releases = await r.json();
  const release = Array.isArray(releases) ? releases.find((item) => item && !item.draft) : releases;
  if (!release) throw new Error('GitHub releases lookup returned no published release');

  return {
    version: (release.tag_name || '').replace(/^v/, ''),
    publishedAt: release.published_at,
    notes: release.body || '',
    assets: {
      androidApk: pickAsset(release.assets, '.apk'),
      desktopWin: pickAsset(release.assets, '.exe'),
      desktopMac: pickAsset(release.assets, '.dmg'),
      desktopLinux: pickAsset(release.assets, '.AppImage'),
    },
  };
}

export async function getLatestVersionInfo() {
  return fetchLatestRelease();
}

export const _internal = { pickAsset };
