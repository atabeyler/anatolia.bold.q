import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { getLatestVersionInfo, getLatestReleaseAssets, findReleaseAssetByFilename, fetchAssetBinary } from '../services/releaseVersion.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const PLATFORM_ASSET_KEY = {
  android: 'androidApk',
  windows: 'desktopWin',
  mac: 'desktopMac',
  linux: 'desktopLinux',
};

// APP_URL is meant to be a full origin (e.g. "https://app.example.com"),
// but has repeatedly been misconfigured as a bare host with no scheme --
// a schemeless URL handed to a native client's fetch() gets silently
// resolved as *relative* to whatever origin the app's WebView happens to
// be on, downloading the wrong thing entirely (the SPA's own index.html,
// not the binary) with no error until the OS fails to install/open it.
// Defaulting the scheme here turns that failure mode into a working link
// instead of a silent wrong-content download.
function resolvedAppUrl() {
  const raw = (process.env.APP_URL || 'http://localhost:10000').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Always rewritten to this server's own /download/:platform, never GitHub's
// browser_download_url -- this repo being public would otherwise make it
// tempting to hand that URL straight to the client (see git history), but
// that leaks github.com/objects.githubusercontent.com straight into the
// client's network traffic and any download manager, which the product
// deliberately doesn't want end users to see. The one-time proxy bandwidth
// cost of always streaming through here (below) buys that opacity.
router.get('/latest', async (_req, res) => {
  try {
    const info = await getLatestVersionInfo();
    const appUrl = resolvedAppUrl();
    const assets = { ...info.assets };
    for (const [platform, key] of Object.entries(PLATFORM_ASSET_KEY)) {
      if (assets[key]) assets[key] = { ...assets[key], url: `${appUrl}/api/version/download/${platform}` };
    }
    res.json({ version: info.version, publishedAt: info.publishedAt, notes: info.notes, assets });
  } catch (err) {
    logger.warn({ err }, '[Version] latest-release lookup failed');
    res.status(502).json({ error: 'Sürüm bilgisi alınamadı' });
  }
});

// Always streams the actual installer/APK bytes through this server --
// never redirects to GitHub (see /latest above for why). GitHub's asset API
// (fetchAssetBinary) serves public-repo assets unauthenticated the same way
// it serves private ones with GITHUB_TOKEN, so this one code path covers
// both. Kept for Android (which still downloads its APK from the URL
// /latest above returns) and for any older installed desktop client that
// predates the /generic/* differential feed below; a corrupted proxy pass
// here is still safe for both -- Android's OS-level APK signature check
// rejects a tampered/truncated file, and this route was never the one
// desktop's NSIS installer trusted blindly.
router.get('/download/:platform', async (req, res) => {
  const assetKey = PLATFORM_ASSET_KEY[req.params.platform];
  if (!assetKey) return res.status(404).json({ error: 'Bilinmeyen platform' });

  try {
    const info = await getLatestVersionInfo();
    const asset = info.assets[assetKey];
    if (!asset) return res.status(404).json({ error: 'İndirilecek dosya bulunamadı' });

    const upstream = await fetchAssetBinary(asset.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    logger.warn({ err }, '[Version] download failed');
    if (!res.headersSent) res.status(502).json({ error: 'Dosya indirilemedi' });
  }
});

// electron-updater's "generic" provider feed for the desktop differential
// (blockmap) update path -- see desktop/main.js's autoUpdater.setFeedURL().
// electron-builder's GitHub publish step already uploads latest.yml (win),
// latest-mac.yml, latest-linux.yml, and a .blockmap next to each installer
// on every release; electron-updater fetches the platform-appropriate yml
// file from the feed's base URL, so all this route has to do is find that
// exact-named asset, rewrite the URL(s) inside it to point back at
// /generic/download/:filename below, and hand back the edited YAML --
// never GitHub's own asset URLs (same reasoning as /latest above).
const FEED_FILES = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml']);

router.get('/generic/:feedFile', async (req, res) => {
  if (!FEED_FILES.has(req.params.feedFile)) return res.status(404).json({ error: 'Bilinmeyen feed dosyası' });

  try {
    const assets = await getLatestReleaseAssets();
    const feedAsset = assets.find((a) => a.name === req.params.feedFile);
    if (!feedAsset) return res.status(404).json({ error: 'Güncelleme feed dosyası bulunamadı' });

    const upstream = await fetchAssetBinary(feedAsset.id);
    const text = await upstream.text();
    const doc = loadYaml(text);
    const appUrl = resolvedAppUrl();
    const toOwnUrl = (name) => `${appUrl}/api/version/generic/download/${encodeURIComponent(path.basename(name))}`;

    if (Array.isArray(doc?.files)) {
      doc.files = doc.files.map((f) => ({ ...f, url: toOwnUrl(f.url) }));
    }
    // Legacy top-level fields electron-updater also reads on some versions.
    if (doc?.path) doc.path = toOwnUrl(doc.path);

    res.type('text/yaml').send(dumpYaml(doc));
  } catch (err) {
    logger.warn({ err }, '[Version] generic feed lookup failed');
    res.status(502).json({ error: 'Güncelleme bilgisi alınamadı' });
  }
});

// Streams an installer/blockmap by its exact published filename, forwarding
// any Range header so electron-updater's differential downloader can pull
// just the byte ranges it needs instead of the whole file (see
// fetchAssetBinary's comment). filename is matched only against published
// asset names -- never used to build a path on disk -- so there's no
// traversal surface despite taking it verbatim from the URL.
//
// Searches recent releases, not just the latest one: differential updates
// need the *previous* version's blockmap/exe too (see
// findReleaseAssetByFilename's comment), and that file only exists in an
// older release.
router.get('/generic/download/:filename', async (req, res) => {
  try {
    const asset = await findReleaseAssetByFilename(path.basename(req.params.filename));
    if (!asset) return res.status(404).json({ error: 'Dosya bulunamadı' });

    const upstream = await fetchAssetBinary(asset.id, req.headers.range || null);
    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    logger.warn({ err }, '[Version] generic download failed');
    if (!res.headersSent) res.status(502).json({ error: 'Dosya indirilemedi' });
  }
});

export default router;
