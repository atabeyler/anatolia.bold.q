import express from 'express';
import { getLatestVersionInfo } from '../services/releaseVersion.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Public (no auth) -- both the Android and desktop apps need to check this
// before/without necessarily being logged in, same reasoning as
// /api/health. Only the version metadata is served from here; the actual
// installer/APK download still goes straight to the GitHub Releases asset
// URL this returns once the user approves the update.
router.get('/latest', async (req, res) => {
  try {
    const info = await getLatestVersionInfo();
    res.json(info);
  } catch (err) {
    logger.warn({ err }, '[Version] latest-release lookup failed');
    res.status(502).json({ error: 'Sürüm bilgisi alınamadı' });
  }
});

export default router;
