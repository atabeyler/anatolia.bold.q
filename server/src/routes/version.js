import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getLatestVersionInfo, fetchAssetBinary } from '../services/releaseVersion.js';
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
// both. This used to redirect for a public repo instead, on the theory that
// piping the bytes through Node risked NSIS integrity failures on the
// client -- that risk is now covered by the client's own fail-closed
// SHA-256 check (desktop/appUpdate.js), which deletes and forces a re-download
// of anything that doesn't match, so a corrupted proxy pass can no longer
// result in a broken install, only a retry.
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

export default router;
