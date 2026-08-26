import express from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDb, isDbConfigured } from '../db/client.js';
import { analyses, emergencyLogs } from '../db/schema.js';
import { generateReportDocx } from '../services/docx.js';
import { generateReportPdf } from '../services/pdf.js';
import { getTodayBriefing, getBriefingByDate, listBriefingDates, generateMorningBriefIfNeeded } from '../services/morningBrief.js';
import { classifyData } from '../services/decisionIntelligence.js';
import { canAccessClassification } from '../lib/rbac.js';

const router = express.Router();
const PUBLIC_CLOUD_PROVIDER_LABEL = 'Q CLOUD';

// The frontend still expects snake_case field names (HistoryView.jsx, HomeView.jsx) —
// Drizzle results (camelCase) are mapped through this to preserve the old API contract.
const toAnalysisJson = (row) => ({
  id: row.id,
  user_code: row.userCode,
  category: row.category,
  title: row.title,
  content: row.content,
  ai_provider: row.aiProvider ? PUBLIC_CLOUD_PROVIDER_LABEL : null,
  priority: row.priority,
  depth: row.depth,
  created_at: row.createdAt,
});

router.get('/morning-brief/today', authMiddleware, async (req, res) => {
  try {
    const briefing = await getTodayBriefing();
    if (!briefing) return res.json({ exists: false });
    res.json({
      exists: true,
      date: briefing.briefing_date,
      generatedAt: briefing.generated_at,
      timezone: briefing.timezone,
      sources: briefing.sources_json || [],
      items: briefing.items_json || [],
      summary: briefing.summary_text || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/morning-brief/list', authMiddleware, async (req, res) => {
  try {
    const dates = await listBriefingDates(30);
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/morning-brief/date/:date', authMiddleware, async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: 'Geçersiz tarih formatı' });
    }
    const briefing = await getBriefingByDate(req.params.date);
    if (!briefing) return res.json({ exists: false });
    res.json({
      exists: true,
      date: briefing.briefing_date,
      generatedAt: briefing.generated_at,
      timezone: briefing.timezone,
      sources: briefing.sources_json || [],
      items: briefing.items_json || [],
      summary: briefing.summary_text || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/morning-brief/refresh', authMiddleware, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Yetkisiz' });
    await generateMorningBriefIfNeeded(true);
    const briefing = await getTodayBriefing();
    if (!briefing) return res.json({ success: false, exists: false });
    res.json({
      success: true,
      exists: true,
      date: briefing.briefing_date,
      generatedAt: briefing.generated_at,
      timezone: briefing.timezone,
      sources: briefing.sources_json || [],
      items: briefing.items_json || [],
      summary: briefing.summary_text || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', authMiddleware, async (req, res) => {
  try {
    if (!isDbConfigured()) return res.json([]);

    const scoped = req.user?.isAdmin
      ? getDb().select().from(analyses).where(isNull(analyses.deletedAt)).orderBy(desc(analyses.createdAt)).limit(100)
      : getDb()
          .select()
          .from(analyses)
          .where(and(eq(analyses.userCode, req.user.userCode), isNull(analyses.deletedAt)))
          .orderBy(desc(analyses.createdAt))
          .limit(100);

    const rows = await scoped;

    res.json(
      rows.map((r) => ({ ...toAnalysisJson(r), preview: (r.content || '').slice(0, 200) }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/feed -- recent system activity
router.get('/feed', authMiddleware, async (req, res) => {
  try {
    if (!isDbConfigured()) return res.json([]);

    const db = getDb();
    const isAdmin = !!req.user?.isAdmin;
    const [analysisRows, emergencyRows] = await Promise.all([
      isAdmin
        ? db.select().from(analyses).where(isNull(analyses.deletedAt)).orderBy(desc(analyses.createdAt)).limit(15)
        : db
            .select()
            .from(analyses)
            .where(and(eq(analyses.userCode, req.user.userCode), isNull(analyses.deletedAt)))
            .orderBy(desc(analyses.createdAt))
            .limit(15),
      isAdmin
        ? db.select().from(emergencyLogs).orderBy(desc(emergencyLogs.createdAt)).limit(10)
        : db
            .select()
            .from(emergencyLogs)
            .where(eq(emergencyLogs.userCode, req.user.userCode))
            .orderBy(desc(emergencyLogs.createdAt))
            .limit(10),
    ]);

    const rows = [
      ...analysisRows.map((r) => ({
        type: 'analysis',
        id: r.id,
        user_code: r.userCode,
        category: r.category,
        title: r.title,
        message: null,
        target: null,
        created_at: r.createdAt,
      })),
      ...emergencyRows.map((r) => ({
        type: 'emergency',
        id: r.id,
        user_code: r.userCode,
        category: null,
        title: null,
        message: r.message,
        target: r.target,
        created_at: r.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The `analyses` table itself carries no classification -- it's derived
// the same way decisionIntelligence.js's saveDecisionRecord() does
// (classifyData(category)), so a role that couldn't have generated a
// CONFIDENTIAL/RESTRICTED report in the first place (see routes/analysis.js's
// /generate gate) also can't read/export/download one after the fact --
// including one belonging to another user that an admin is looking up.
function blockedByClassification(req, row) {
  return !canAccessClassification(req.user, classifyData(row.category));
}

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(404).json({ error: 'DB yok' });

    const [row] = await getDb().select().from(analyses).where(eq(analyses.id, Number(req.params.id)));
    if (!row || row.deletedAt) return res.status(404).json({ error: 'Bulunamadi' });
    if (!req.user?.isAdmin && row.userCode !== req.user.userCode) {
      return res.status(404).json({ error: 'Bulunamadi' });
    }
    if (blockedByClassification(req, row)) {
      return res.status(403).json({ error: 'Bu veri sınıfına erişim yetkiniz yok' });
    }
    res.json(toAnalysisJson(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(404).json({ error: 'DB yok' });

    const [row] = await getDb().select().from(analyses).where(eq(analyses.id, Number(req.params.id)));
    if (!row || row.deletedAt) return res.status(404).json({ error: 'Bulunamadi' });
    if (!req.user?.isAdmin && row.userCode !== req.user.userCode) {
      return res.status(404).json({ error: 'Bulunamadi' });
    }
    if (blockedByClassification(req, row)) {
      return res.status(403).json({ error: 'Bu veri sınıfına erişim yetkiniz yok' });
    }

    const buf = await generateReportDocx({
      category: row.category,
      title: row.title,
      content: row.content,
      userCode: row.userCode,
      aiProvider: row.aiProvider ? PUBLIC_CLOUD_PROVIDER_LABEL : null
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="ANATOLIA-Q_${row.category}_${row.id}.docx"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/download-pdf', authMiddleware, async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(404).json({ error: 'DB yok' });

    const [row] = await getDb().select().from(analyses).where(eq(analyses.id, Number(req.params.id)));
    if (!row || row.deletedAt) return res.status(404).json({ error: 'Bulunamadi' });
    if (!req.user?.isAdmin && row.userCode !== req.user.userCode) {
      return res.status(404).json({ error: 'Bulunamadi' });
    }
    if (blockedByClassification(req, row)) {
      return res.status(403).json({ error: 'Bu veri sınıfına erişim yetkiniz yok' });
    }

    const buf = await generateReportPdf({
      category: row.category,
      title: row.title,
      content: row.content,
      userCode: row.userCode,
      aiProvider: row.aiProvider ? PUBLIC_CLOUD_PROVIDER_LABEL : null
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ANATOLIA-Q_${row.category}_${row.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
