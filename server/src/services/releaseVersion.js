// Looks up the latest published GitHub Release so the Android/desktop
// clients never have to talk to GitHub at all -- an institutional
// deployment constraint, client devices only ever talk to this server.
// Both the version-check metadata *and* the actual installer/APK download
// are proxied through here (see routes/version.js's /download/:platform,
// which streams the browser_download_url this returns) -- the client
// never sees a github.com address anywhere in the update flow.
const REPO = 'atabeyler/anatolia.bold.q';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

// GitHub computes and serves a SHA-256 digest for every release asset
// itself (the `digest` field, e.g. "sha256:abcd...") -- surfacing it here
// lets desktop/appUpdate.js verify the downloaded installer's integrity
// before ever executing it (see AQ-003 hardening), without this server or
// the release workflow having to separately generate/publish checksums.
function extractSha256(digest) {
  if (!digest) return null;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest);
  return m ? m[1].toLowerCase() : null;
}

function pickAsset(assets, suffix) {
  const asset = (assets || []).find((a) => a.name?.endsWith(suffix));
  return asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size, sha256: extractSha256(asset.digest) } : null;
}

async function fetchLatestRelease() {
  const r = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'anatolia-q-server' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`GitHub releases lookup failed (HTTP ${r.status})`);
  const releases = await r.json();
  // GitHub's /releases response is normally created_at-descending, but that
  // ordering isn't a documented contract -- sorting explicitly by
  // published_at means a future change to release/tag creation order (or
  // GitHub's own API behavior) can't silently pick a stale release as
  // "latest".
  const candidates = Array.isArray(releases) ? releases.filter((item) => item && !item.draft) : (releases ? [releases] : []);
  const release = candidates.sort(
    (a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
  )[0];
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

export const _internal = { pickAsset, extractSha256 };
