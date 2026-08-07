import express from 'express';
import { and, desc, eq, lt } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDb, isDbConfigured } from '../db/client.js';
import { userProfiles, conversationMemory } from '../db/schema.js';
import { generateAnalysis } from '../services/ai.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Retention policy for conversationMemory, mirroring the disk-upload TTL
// sweep in routes/files.js (DISK_FILE_TTL_MS) -- these are user-initiated
// saved consultations rather than incidental uploads, so the default
// window is much longer, and archiving (see PATCH /conversations/:id/archive)
// does not exempt a conversation from it.
const CONVERSATION_MEMORY_TTL_MS = (Number(process.env.CONVERSATION_MEMORY_TTL_DAYS) || 180) * 24 * 60 * 60 * 1000;

async function cleanupOldConversations() {
  if (!isDbConfigured()) return;
  try {
    const cutoff = new Date(Date.now() - CONVERSATION_MEMORY_TTL_MS);
    await getDb().delete(conversationMemory).where(lt(conversationMemory.createdAt, cutoff));
  } catch (err) {
    logger.warn({ err }, '[Memory] Conversation TTL cleanup failed');
  }
}
setInterval(cleanupOldConversations, 6 * 60 * 60 * 1000).unref();
cleanupOldConversations();

const toProfileJson = (row) => ({
  user_code: row.userCode,
  display_name: row.displayName,
  rank: row.rank,
  unit: row.unit,
  preferred_persona: row.preferredPersona,
  preferred_lang: row.preferredLang,
});

const toConversationJson = (row) => ({
  id: row.id,
  session_title: row.sessionTitle,
  persona_id: row.personaId,
  summary: row.summary,
  key_facts: row.keyFacts,
  archived: row.archived,
  created_at: row.createdAt,
});

// ── Get/create user profile ──────────────────────────────────────────────
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    if (!isDbConfigured()) return res.json({ userCode, display_name: userCode });

    const db = getDb();
    let [row] = await db.select().from(userProfiles).where(eq(userProfiles.userCode, userCode));
    if (!row) {
      [row] = await db
        .insert(userProfiles)
        .values({ userCode, displayName: userCode, preferredPersona: 'general', preferredLang: 'tr' })
        .returning();
    }
    res.json(toProfileJson(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update user profile ──────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    const { display_name, rank, unit, preferred_persona, preferred_lang } = req.body;

    if (!isDbConfigured()) return res.json({ success: true });

    const values = {
      userCode,
      displayName: display_name,
      rank,
      unit,
      preferredPersona: preferred_persona,
      preferredLang: preferred_lang,
      updatedAt: new Date(),
    };
    await getDb()
      .insert(userProfiles)
      .values(values)
      .onConflictDoUpdate({ target: userProfiles.userCode, set: values });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Save and summarize the conversation ──────────────────────────────────
router.post('/save-conversation', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    const { history, personaId, sessionTitle } = req.body;

    if (!history?.length) return res.status(400).json({ error: 'Geçmiş boş' });

    // Summarize the conversation and extract key facts with AI
    let summary = '';
    let keyFacts = '';
    try {
      const summaryPrompt = `Aşağıdaki danışma konuşmasını özetle:
1. Konuşulan ana konular (2-3 madde)
2. Varılan önemli sonuçlar
3. Hatırlanması gereken kritik bilgiler

Konuşma geçmişi:
${history.map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${m.content}`).join('\n')}

KISA ve öz yanıt ver — maksimum 300 kelime.`;

      const result = await generateAnalysis(
        'Sen bir konuşma özetleyicisisin. Kısa ve öz özetle.',
        summaryPrompt
      );
      summary = result.content;

      // Extract key facts
      const factsPrompt = `Bu konuşmadan ileride hatırlanması gereken en önemli 5 bilgiyi madde madde çıkar:
${history.map(m => `${m.role === 'user' ? 'K' : 'A'}: ${m.content.slice(0, 200)}`).join('\n')}`;

      const factsResult = await generateAnalysis(
        'Anahtar bilgileri madde madde listele.',
        factsPrompt
      );
      keyFacts = factsResult.content;
    } catch {
      summary = 'Özet üretilemedi.';
      keyFacts = '';
    }

    let savedId = null;
    if (isDbConfigured()) {
      const [row] = await getDb()
        .insert(conversationMemory)
        .values({
          userCode,
          sessionTitle: sessionTitle || `Danışma — ${new Date().toLocaleString('tr-TR')}`,
          personaId,
          summary,
          keyFacts,
          fullHistory: history,
        })
        .returning({ id: conversationMemory.id });
      savedId = row.id;
    }

    res.json({ success: true, id: savedId, summary, keyFacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List saved conversations ─────────────────────────────────────────────
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    if (!isDbConfigured()) return res.json([]);

    const rows = await getDb()
      .select()
      .from(conversationMemory)
      .where(eq(conversationMemory.userCode, userCode))
      .orderBy(desc(conversationMemory.createdAt))
      .limit(50);
    res.json(rows.map(toConversationJson));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get a specific conversation ───────────────────────────────────────────
router.get('/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    if (!isDbConfigured()) return res.status(404).json({ error: 'DB yok' });

    const [row] = await getDb()
      .select()
      .from(conversationMemory)
      .where(and(eq(conversationMemory.id, Number(req.params.id)), eq(conversationMemory.userCode, userCode)));
    if (!row) return res.status(404).json({ error: 'Bulunamadı' });
    res.json({ ...toConversationJson(row), full_history: row.fullHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Archive / unarchive a conversation ───────────────────────────────────
router.patch('/conversations/:id/archive', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    const { archived } = req.body;
    if (!isDbConfigured()) return res.json({ success: true });

    await getDb()
      .update(conversationMemory)
      .set({ archived })
      .where(and(eq(conversationMemory.id, Number(req.params.id)), eq(conversationMemory.userCode, userCode)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete a conversation ─────────────────────────────────────────────────
router.delete('/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    if (!isDbConfigured()) return res.json({ success: true });
    await getDb()
      .delete(conversationMemory)
      .where(and(eq(conversationMemory.id, Number(req.params.id)), eq(conversationMemory.userCode, userCode)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get context from memory (when starting a new conversation) ───────────
router.get('/context', authMiddleware, async (req, res) => {
  try {
    const { userCode } = req.user;
    if (!isDbConfigured()) return res.json({ context: '' });

    // Get the summary and key facts of the last 5 conversations
    const rows = await getDb()
      .select()
      .from(conversationMemory)
      .where(and(eq(conversationMemory.userCode, userCode), eq(conversationMemory.archived, false)))
      .orderBy(desc(conversationMemory.createdAt))
      .limit(5);

    if (rows.length === 0) return res.json({ context: '', conversations: [] });

    const context = rows.map(row =>
      `[${new Date(row.createdAt).toLocaleDateString('tr-TR')} — ${row.sessionTitle}]\n${row.summary}\nÖnemli bilgiler: ${row.keyFacts || 'Yok'}`
    ).join('\n\n---\n\n');

    res.json({ context, conversations: rows.map(toConversationJson) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
