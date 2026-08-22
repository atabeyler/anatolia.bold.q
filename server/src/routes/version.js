import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getLatestVersionInfo, fetchAssetBinary } from '../services/releaseVersion.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const APP_URL = process.env.APP_URL || 'http://localhost:10000';

const PLATFORM_ASSET_KEY = {
  android: 'androidApk',
  windows: 'desktopWin',
  mac: 'desktopMac',
  linux: 'desktopLinux',
};

// While this repo is public, a release asset's plain browser_download_url
// works for anyone -- handing it straight to the client avoids re-streaming
// NSIS/DMG/APK/AppImage bytes through this server. Once the repo goes
// private, that same URL 404s unauthenticated (GitHub only honors the
// GITHUB_TOKEN on the asset *API*, not on the public download link) -- so
// in that case /latest instead points clients at our own /download/:platform
// below, which proxies the bytes through with that token attached.
router.get('/latest', async (_req, res) => {
  try {
    const info = await getLatestVersionInfo();
    const assets = { ...info.assets };
    if (process.env.GITHUB_TOKEN) {
      for (const [platform, key] of Object.entries(PLATFORM_ASSET_KEY)) {
        if (assets[key]) assets[key] = { ...assets[key], url: `${APP_URL}/api/version/download/${platform}` };
      }
    }
    res.json({ version: info.version, publishedAt: info.publishedAt, notes: info.notes, assets });
  } catch (err) {
    logger.warn({ err }, '[Version] latest-release lookup failed');
    res.status(502).json({ error: 'Sürüm bilgisi alınamadı' });
  }
});

// Proxies the actual installer/APK bytes when this repo is private (see
// /latest above); also kept for compatibility with older installed clients
// that were shipped with /api/version/download/:platform URLs regardless of
// repo visibility.
router.get('/download/:platform', async (req, res) => {
  const assetKey = PLATFORM_ASSET_KEY[req.params.platform];
  if (!assetKey) return res.status(404).json({ error: 'Bilinmeyen platform' });

  try {
    const info = await getLatestVersionInfo();
    const asset = info.assets[assetKey];
    if (!asset) return res.status(404).json({ error: 'İndirilecek dosya bulunamadı' });

    if (!process.env.GITHUB_TOKEN) {
      // Public repo: redirect rather than piping the installer through
      // Node/hosting. This preserves the exact GitHub Release binary and
      // fixes NSIS integrity failures caused on the proxy path. 307
      // preserves request semantics.
      return res.redirect(307, asset.url);
    }

    // Private repo: stream the bytes from GitHub's authenticated asset
    // endpoint through to the client, since the plain download URL 404s
    // unauthenticated.
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
