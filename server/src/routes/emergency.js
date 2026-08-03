import express from 'express';
import { sendEmergencyAlert } from '../services/email.js';
import { getDb, isDbConfigured } from '../db/client.js';
import { emergencyLogs } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOptionalUserCode } from '../lib/optionalAuth.js';
import { publicActionLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

const MAX_MESSAGE_LENGTH = 2000;
const MAX_REGION_LENGTH = 100;

function validMessage(message) {
  return typeof message === 'string' && message.trim().length > 0 && message.length <= MAX_MESSAGE_LENGTH;
}

function validRegion(region) {
  return region === undefined || region === null || (typeof region === 'string' && region.length <= MAX_REGION_LENGTH);
}

// Emergency notification accessible without authentication (pre-login center button)
router.post('/center', publicActionLimiter, async (req, res) => {
  try {
    const { message, region } = req.body;
    if (!validMessage(message)) return res.status(400).json({ error: 'Geçerli bir mesaj gerekli (en fazla 2000 karakter)' });
    if (!validRegion(region)) return res.status(400).json({ error: 'Bölge adı çok uzun' });

    const userCode = getOptionalUserCode(req);

    if (isDbConfigured()) {
      await getDb().insert(emergencyLogs).values({ userCode, message, target: 'center', region: region || null });
    }

    await sendEmergencyAlert(userCode, message, region);
    res.json({ success: true, message: 'Acil bildirim merkeze iletildi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Emergency broadcast to every other logged-in user's live session -- unlike
// /center and /region (which only ever reach the center mailbox), this reaches
// every connected client's screen in real time, so it requires a valid login
// rather than just an IP rate limit.
router.post('/users', authMiddleware, publicActionLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (!validMessage(message)) return res.status(400).json({ error: 'Geçerli bir mesaj gerekli (en fazla 2000 karakter)' });

    const userCode = req.user.userCode;

    if (isDbConfigured()) {
      await getDb().insert(emergencyLogs).values({ userCode, message, target: 'users' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('emergency:broadcast', {
        from: userCode,
        message,
        timestamp: Date.now()
      });
    }

    res.json({ success: true, message: 'Tüm kullanıcılara iletildi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regional emergency notification from a map pin
router.post('/region', publicActionLimiter, async (req, res) => {
  try {
    const { region, message } = req.body;
    if (!validMessage(message)) return res.status(400).json({ error: 'Geçerli bir mesaj gerekli (en fazla 2000 karakter)' });
    if (!validRegion(region)) return res.status(400).json({ error: 'Bölge adı çok uzun' });

    const userCode = getOptionalUserCode(req);

    if (isDbConfigured()) {
      await getDb().insert(emergencyLogs).values({ userCode, message, target: 'region', region });
    }

    await sendEmergencyAlert(userCode, message, region);
    res.json({ success: true, message: `${region} bölgesi için merkeze bildirim gönderildi.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
