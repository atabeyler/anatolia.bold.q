import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { isS3Configured, uploadObject, getPresignedDownloadUrl } from '../lib/objectStorage.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { scanFile } from '../lib/fileScan.js';
import { logAuditEvent } from '../services/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const USE_S3 = isS3Configured();
const DISK_FILE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Disk-mode uploads are never referenced by ID/owner, so a periodic sweep
// deletes anything older than the TTL to bound disk growth (only relevant
// when S3/R2 isn't configured -- that mode has no lifecycle rule of its own).
function cleanupOldUploads() {
  if (USE_S3) return;
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    for (const f of files) {
      const filePath = path.join(UPLOAD_DIR, f);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > DISK_FILE_TTL_MS) {
          fs.unlink(filePath, () => {});
        }
      });
    }
  });
}
setInterval(cleanupOldUploads, 6 * 60 * 60 * 1000).unref();
cleanupOldUploads();

// In S3/R2 mode the file is buffered in memory and uploaded manually; in disk
// mode the existing behavior (writing to disk with a uuid filename) is unchanged.
const storage = USE_S3
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => cb(null, uuidv4() + (path.extname(file.originalname) || '')),
    });

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

// Extensions the browser would otherwise render/execute as active content if
// opened directly (same-origin stored XSS) instead of treating as inert data
// -- these are forced to download rather than open inline. Everything else
// (images, PDF, DOCX, etc.) keeps the existing inline-preview behavior that
// the chat/report UI already depends on (see FileMessageContent).
const ACTIVE_CONTENT_EXTS = /\.(html?|xhtml|svg|xml|mhtml|js|mjs)$/i;

router.post('/upload', authMiddleware, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Dosya bulunamadı' });

    // Optional classification hint (AQ-013) -- callers that know the
    // upload is headed for a CONFIDENTIAL/RESTRICTED analysis can pass it
    // so a scan-webhook outage fails closed instead of open for those; any
    // other/missing value defaults to INTERNAL, matching the previous
    // (unscanned) behavior when no scan webhook is configured at all.
    const classification = req.body?.classification;

    // Malware scan / CDR hook (see lib/fileScan.js): a no-op pass unless
    // FILE_SCAN_WEBHOOK_URL is configured, so an unconfigured deployment's
    // upload flow is completely unchanged. Runs on disk-mode content by
    // reading the just-written file back (multer already wrote it), and on
    // S3-mode content from the in-memory buffer before it ever leaves this
    // process, in both cases before the file becomes downloadable/attached
    // to anything.
    const buffer = USE_S3 ? file.buffer : fs.readFileSync(file.path);
    const scanResult = await scanFile(buffer, { filename: file.originalname, mimetype: file.mimetype, classification });
    if (!scanResult.ok) {
      if (!USE_S3) fs.unlink(file.path, () => {});
      await logAuditEvent(req.user, 'file_scan_rejected', req.user.userCode, {
        filename: file.originalname, mimetype: file.mimetype, classification, reason: scanResult.reason,
      });
      return res.status(422).json({ error: 'Dosya güvenlik taramasından geçemedi', reason: scanResult.reason });
    }

    if (USE_S3) {
      const key = uuidv4() + (path.extname(file.originalname) || '');
      await uploadObject(key, file.buffer, file.mimetype);
      return res.json({
        url: `/api/files/${key}`,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    }

    res.json({
      url: `/api/files/${file.filename}`,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:filename', async (req, res) => {
  const name = path.basename(req.params.filename);
  const forceAttachment = ACTIVE_CONTENT_EXTS.test(name);
  res.set('X-Content-Type-Options', 'nosniff');

  if (USE_S3) {
    try {
      const url = await getPresignedDownloadUrl(name, 300, forceAttachment);
      return res.redirect(url);
    } catch (err) {
      return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
  }

  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Dosya bulunamadı' });
  if (forceAttachment) {
    return res.download(filePath, name);
  }
  res.sendFile(filePath);
});

export default router;
