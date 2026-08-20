import { findReports, summarizeReport } from './offlineExtractive.js';

// Mirrors desktop/localAI/rag.js -- same keyword-scored retrieval over the
// local SQLite archive (offlineExtractive.findReports), reused rather than
// duplicated as a separate index/embedding store. See that module's
// comment for why this is a deliberate, honest choice over a fabricated
// vector DB.
export async function retrieveContext(db, userId, queryText, { limit = 3, maxCharsPerDoc = 400 } = {}) {
  // Smaller limit/snippet size than desktop: phone-class inference is
  // slower per token, so keeping the prompt shorter matters more here.
  const matches = await findReports(db, userId, queryText, { limit });
  const docs = [];
  for (const m of matches) {
    const summary = await summarizeReport(db, userId, m.id, { maxSentences: 2 });
    docs.push({ id: m.id, title: m.title, category: m.category, createdAt: m.createdAt, snippet: (summary?.summary || m.preview || '').slice(0, maxCharsPerDoc) });
  }
  return docs;
}

// See desktop/localAI/rag.js's comment: this system/user split was
// verified in this sandbox (via node-llama-cpp, the desktop runtime) to
// produce much better-grounded answers than concatenating everything into
// one user message.
export const SYSTEM_PROMPT =
  'Sen ANATOLIA-Q uygulamasının tamamen çevrimdışı çalışan yerel yapay zeka asistanısın. ' +
  'Yalnızca sana verilen bağlama dayan; internete veya buluta erişimin yok. Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma. ' +
  'Türkçe ve öz cevap ver.';

export function buildPrompt({ instruction, contextDocs, userText, lang = 'tr' }) {
  const contextBlock = contextDocs.length
    ? contextDocs.map((d, i) => `[${i + 1}] "${d.title}" (${d.category}, ${new Date(d.createdAt).toLocaleDateString()})\n${d.snippet}`).join('\n\n')
    : '(kullanıcının cihazında ilgili geçmiş rapor bulunamadı)';

  return [
    instruction,
    `Dil: ${lang}`,
    'Bağlam (kullanıcının cihazındaki geçmiş raporlar):',
    contextBlock,
    'Soru/istek:',
    userText,
  ].join('\n\n');
}
