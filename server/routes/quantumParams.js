const express = require('express');
const { getAll, upsert } = require('../services/quantumParamsService');
const { ALLOWED_FEATURES } = require('../lib/features');
// Replace with your project's admin auth middleware
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List all quantum params (admin only)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const rows = await getAll();
    res.json(rows);
  } catch (err) { next(err); }
});

// Update a feature (dos, fuzz, intrusive)
router.put('/:feature', requireAdmin, async (req, res, next) => {
  try {
    const { feature } = req.params;
    const { enabled, expires_at, reason } = req.body;
    if (!ALLOWED_FEATURES.includes(feature)) return res.status(400).json({ error: 'invalid feature' });
    // safety: max expiry 24h (customize as needed)
    const maxHours = 24;
    if (expires_at) {
      const expires = new Date(expires_at);
      if (expires - Date.now() > maxHours * 3600 * 1000) {
        return res.status(400).json({ error: `expires_at too far; max ${maxHours} hours` });
      }
    }
    const updated = await upsert(feature, {
      enabled: !!enabled,
      expires_at: expires_at ? new Date(expires_at) : null,
      updated_by: req.user && req.user.username ? req.user.username : (req.user && req.user.id) || 'unknown',
      reason: reason || null
    });
    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
