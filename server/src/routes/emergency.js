import express from 'express';
import { sendEmergencyAlert } from '../services/email.js';
import { getDb, isDbConfigured } from '../db/client.js';
import { emergencyLogs } from '../db/schema.js';
import jwt from 'jsonwebtoken';
import { publicActionLimiter } from '../middleware/rateLimit.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Emergency notification accessible without authentication (pre-login center button)
router.post('/center', publicActionLimiter, async (req, res) => {
  try {
    const { message, region } = req.body;
    const auth = req.headers.authorization;
    let userCode = 'ANONİM';

    if (auth?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        userCode = decoded.userCode;
      } catch { /* invalid token — continue as ANONİM */ }
    }

    if (isDbConfigured()) {
      await getDb().insert(emergencyLogs).values({ userCode, message, target: 'center', region: region || null });
    }

    await sendEmergencyAlert(userCode, message, region);
    res.json({ success: true, message: 'Acil bildirim merkeze iletildi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Emergency notification to other users
router.post('/users', publicActionLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    const auth = req.headers.authorization;
    let userCode = 'ANONİM';

    if (auth?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        userCode = decoded.userCode;
      } catch { /* invalid token — continue as ANONİM */ }
    }

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
    const auth = req.headers.authorization;
    let userCode = 'ANONİM';

    if (auth?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        userCode = decoded.userCode;
      } catch { /* invalid token — continue as ANONİM */ }
    }

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
