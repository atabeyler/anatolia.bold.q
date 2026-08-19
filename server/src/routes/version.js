import express from 'express';
import { getLatestVersionInfo } from '../services/releaseVersion.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const PLATFORM_ASSET_KEY = {
  android: 'androidApk',
  windows: 'desktopWin',
  mac: 'desktopMac',
  linux: 'desktopLinux',
};

// Public (no auth) -- Android/desktop clients need to check this before
// necessarily being logged in. Metadata still comes from our API, but the
// binary URL is the original GitHub Releases asset URL. This deliberately
// avoids re-streaming NSIS/DMG/AppImage bytes through the application
// server: the release asset is already the canonical, tested installer.
router.get('/latest', async (_req, res) => {
  try {
    const info = await getLatestVersionInfo();
    res.json({
      version: info.version,
      publishedAt: info.publishedAt,
      notes: info.notes,
      assets: {
        androidApk: info.assets.androidApk,
        desktopWin: info.assets.desktopWin,
        desktopMac: info.assets.desktopMac,
        desktopLinux: info.assets.desktopLinux,
      },
    });
  } catch (err) {
    logger.warn({ err }, '[Version] latest-release lookup failed');
    res.status(502).json({ error: 'Sürüm bilgisi alınamadı' });
  }
});

// Kept for compatibility with older installed clients that were shipped
// with /api/version/download/:platform URLs. New clients receive the direct
// GitHub asset URL from /latest and no longer use this proxy route.
router.get('/download/:platform', async (req, res) => {
  const assetKey = PLATFORM_ASSET_KEY[req.params.platform];
  if (!assetKey) return res.status(404).json({ error: 'Bilinmeyen platform' });

  try {
    const info = await getLatestVersionInfo();
    const asset = info.assets[assetKey];
    if (!asset) return res.status(404).json({ error: 'İndirilecek dosya bulunamadı' });

    // Redirect rather than piping the installer through Node/hosting. This
    // preserves the exact GitHub Release binary and fixes NSIS integrity
    // failures caused on the proxy path. 307 preserves request semantics.
    return res.redirect(307, asset.url);
  } catch (err) {
    logger.warn({ err }, '[Version] download redirect failed');
    if (!res.headersSent) res.status(502).json({ error: 'Dosya indirilemedi' });
  }
});

export default router;
