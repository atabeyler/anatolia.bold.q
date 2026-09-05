/**
 * Cyber Analysis module -- ANATOLIA-Q's entry point into BCI (BOLD Cyber
 * Intelligence), a separately deployed product with its own database,
 * users, and RBAC. Rather than reimplementing any of BCI's own screens
 * here, this just tells the client where BCI's real admin UI (bci/ui) is
 * -- see services/bciClient.js for the server-to-server gateway trust flow
 * that isn't used by this file directly but backs BCI_BASE_URL's sibling
 * config, and bci/ui/src/api.js for BCI's own API client.
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, ROLES } from '../lib/rbac.js';
import { isBciConfigured } from '../services/bciClient.js';

const router = express.Router();

// Viewer role is intentionally excluded: Cyber Analysis surfaces
// organization-wide risk data, not the kind of thing every ANATOLIA-Q
// account should see by default.
const requireAnalyst = requireRole(ROLES.ADMIN, ROLES.ANALYST);

router.use(authMiddleware, requireAnalyst);

router.get('/status', (_req, res) => {
  res.json({ available: isBciConfigured() });
});

// Points the browser at BCI's own real admin UI (bci/ui -- a separate SPA,
// its own login, talking to bci-api directly) instead of ANATOLIA-Q
// reimplementing any of BCI's screens. Returns the URL as JSON (not an HTTP
// redirect) so both the web build (cookie auth) and the desktop/mobile
// shells (bearer-token auth, via the same req() helper as every other API
// call) can fetch it identically before opening it themselves. Kept
// server-side -- never baked into the client bundle -- for the same reason
// BCI_BASE_URL never is: it's deployment-specific and can change without a
// client rebuild.
router.get('/ui', (_req, res) => {
  const uiUrl = process.env.BCI_UI_URL;
  if (!uiUrl) return res.status(404).json({ error: 'bci_ui_not_configured' });
  res.json({ url: uiUrl });
});

export default router;
