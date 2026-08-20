import { findReports, summarizeReport } from './offlineExtractive.js';

// Simple, real, fully-offline retrieval for the local LLM: reuses the
// existing extractive engine's keyword/date-range scoring (offlineExtractive
// .findReports) to rank the user's own local SQLite reports, then pulls a
// short extractive summary of each top match to keep the injected context
// small (a 1.5B model has a modest context window, and every extra token
// costs generation time on CPU).
//
// Deliberately NOT a vector DB / embedding index: this codebase has no
// lightweight local embedding model already wired up, and fabricating a
// vector store here (per the task's own instruction) would be exactly the
// kind of dependency that can't actually be exercised in this sandbox.
// BM25-adjacent keyword scoring over a per-user table that's realistically
// tens to low-hundreds of rows is a reasonable, honest substitute -- see
// the final report for the tradeoff.
export function retrieveContext(db, userId, queryText, { limit = 4, maxCharsPerDoc = 500 } = {}) {
  const matches = findReports(db, userId, queryText, { limit });
  return matches.map((m) => {
    const summary = summarizeReport(db, userId, m.id, { maxSentences: 3 });
    const snippet = (summary?.summary || m.preview || '').slice(0, maxCharsPerDoc);
    return { id: m.id, title: m.title, category: m.category, createdAt: m.createdAt, snippet };
  });
}

// Fixed identity/rules system prompt, kept separate from the per-request
// instruction+context+question below (which go in the user turn).
// Verified in this sandbox with a real node-llama-cpp + Qwen2.5-1.5B-
// Instruct smoke test that this split matters: concatenating everything
// into one user message made the model narrate about the prompt instead
// of answering it, while a real systemPrompt (passed to LlamaChatSession,
// see llmRuntime.js) gave a direct, correctly-grounded answer -- see the
// final report.
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
