import express from 'express';
import { getLatestVersionInfo } from '../services/releaseVersion.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const PLATFORM_ASSET_KEY = { android: 'androidApk', desktop: 'desktopExe' };

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Public (no auth) -- both the Android and desktop apps need to check this
// before/without necessarily being logged in, same reasoning as
// /api/health. The URLs returned here point back at this server's own
// /download/:platform below, never at github.com directly -- see that
// route's comment.
router.get('/latest', async (req, res) => {
  try {
    const info = await getLatestVersionInfo();
    res.json({
      version: info.version,
      publishedAt: info.publishedAt,
      notes: info.notes,
      assets: {
        androidApk: info.assets.androidApk
          ? { url: `${baseUrl(req)}/api/version/download/android`, name: info.assets.androidApk.name, size: info.assets.androidApk.size }
          : null,
        desktopExe: info.assets.desktopExe
          ? { url: `${baseUrl(req)}/api/version/download/desktop`, name: info.assets.desktopExe.name, size: info.assets.desktopExe.size }
          : null,
      },
    });
  } catch (err) {
    logger.warn({ err }, '[Version] latest-release lookup failed');
    res.status(502).json({ error: 'Sürüm bilgisi alınamadı' });
  }
});

// Streams the installer/APK from GitHub through this server -- the
// institutional constraint is that a client device never talks to GitHub
// at all, not even to download a file (a raw github.com/objects.
// githubusercontent.com address showing up in a browser's download UI is
// exactly what this avoids). Bandwidth cost is accepted as the tradeoff
// for that; each platform's binary is tens of megabytes, not something to
// buffer in memory, so the upstream response body is piped straight
// through rather than read into a buffer first.
router.get('/download/:platform', async (req, res) => {
  const assetKey = PLATFORM_ASSET_KEY[req.params.platform];
  if (!assetKey) return res.status(404).json({ error: 'Bilinmeyen platform' });

  try {
    const info = await getLatestVersionInfo();
    const asset = info.assets[assetKey];
    if (!asset) return res.status(404).json({ error: 'İndirilecek dosya bulunamadı' });

    const upstream = await fetch(asset.url);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: 'Dosya indirilemedi' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
    if (asset.size) res.setHeader('Content-Length', String(asset.size));

    const { Readable } = await import('node:stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    logger.warn({ err }, '[Version] download proxy failed');
    if (!res.headersSent) res.status(502).json({ error: 'Dosya indirilemedi' });
  }
});

export default router;
