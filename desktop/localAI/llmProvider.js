import { retrieveContext, buildPrompt, SYSTEM_PROMPT } from './rag.js';
import { createLlamaRuntime } from './llmRuntime.js';
import { cleanReportOutput, getReportFormat, isPromptEcho } from './reportFormats.js';
import { MODEL_TIERS } from './modelSpec.js';

const HIGH = MODEL_TIERS.high;

const CHAT_INSTRUCTION =
  'Kullanıcının sorusuna, aşağıdaki bağlamı kullanarak Türkçe ve öz bir şekilde cevap ver. ' +
  'Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma.';

const GENERATE_INSTRUCTION =
  'Kullanıcı için istenen konuda profesyonel, yapılandırılmış ve başlıklı bir karar destek analizi yaz. Cevaba talimat, iskelet, soru/istek veya bağlam etiketlerini kopyalama. ' +
  'Aşağıdaki kategoriye özel rapor iskeletini aynen izle; iskelette olmayan, konu dışı bölüm açma. ' +
  'Verilen yerel dosya/verileri öncelikli kaynak olarak kullan. Eski raporlardan veya örneklerden kişi, kurum, banka, proje, silah sistemi veya konu taşıma. ' +
  'Özellikle kullanıcı konusu toplumsal olay ise OPTİMİZASYON PROBLEMİ, QAOA, banka, bütçe, füze, savunma platformu veya kaynak tahsisi bölümü yazma. ' +
  'Kaynakta bulunmayan sayı, olay veya sonuç uydurma. Kesin veri yoksa varsayımı açıkça etiketle.';

// Real generative local-LLM query, registered ahead of offline-extractive
// in registry.js. `runtimeFactory` defaults to the real node-llama-cpp
// wrapper (llmRuntime.js) but is injectable so tests never need an actual
// GGUF file or native addon -- same DI seam the rest of this module already
// uses (modelManager, db).
//
// One session is loaded lazily on first query and kept warm for subsequent
// calls (loading a GGUF file is the expensive part); `dispose()` on the
// returned query function's `.dispose` property lets callers release it
// (e.g. on app quit) -- optional, never required for correctness.
export function createLLMQuery({ db, userId, modelManager, runtimeFactory = createLlamaRuntime } = {}) {
  let runtimePromise = null;

  async function disposeCachedRuntime() {
    if (!runtimePromise) return;
    const currentRuntimePromise = runtimePromise;
    runtimePromise = null;
    try {
      const runtime = await currentRuntimePromise;
      await runtime.dispose?.();
    } catch {
      // A timed-out or failed runtime may already be half-torn-down. The
      // next request will create a fresh runtime; there is nothing useful
      // to surface here beyond the original generation error.
    }
  }

  async function generateWithDeadline(runtime, prompt, options = {}, deadlineMs = 45_000) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('local_llm_timeout'));
      }, deadlineMs);
    });

    try {
      return await Promise.race([
        runtime.generate(prompt, { ...options, timeoutMs: Math.min(options.timeoutMs ?? deadlineMs, deadlineMs) }),
        timeout,
      ]);
    } catch (err) {
      if (err?.message === 'local_llm_timeout') {
        await disposeCachedRuntime();
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function getRuntime() {
    if (!runtimePromise) {
      // Re-verify the model file's SHA-256 on every fresh load, not just
      // once at download time (see modelManager.js's downloadModel()) --
      // isAvailable() above only checks that a file exists at modelPath,
      // not that it's still the file that was originally verified. Without
      // this, a file swapped in later (disk corruption, another local
      // process, malware) would be loaded and executed by node-llama-cpp
      // with no detection. getRuntime() itself only runs once per process
      // (the runtime is cached in runtimePromise), so this cost is paid
      // once per app session, not per query.
      runtimePromise = (async () => {
        const check = await modelManager.verifyChecksum();
        if (!check.ok) {
          throw new Error('local_llm_integrity_check_failed');
        }
        return runtimeFactory({ modelPath: modelManager.modelPath, contextSize: modelManager.spec.contextSize, systemPrompt: SYSTEM_PROMPT });
      })().catch((err) => {
        // A failed load must not be cached as "the" runtime promise --
        // otherwise every subsequent query in this session would
        // permanently fail the same way (e.g. a transient read error)
        // instead of getting a chance to re-verify on the next call.
        runtimePromise = null;
        throw err;
      });
    }
    return runtimePromise;
  }

  async function run(request = {}) {
    const { mode = 'chat', text = '', entityIds = [], category = '', title = '', prompt = '', attachmentContext = '', priority = 'normal', depth = 'standart', quantumRequested = false, lang = 'tr' } = request;

    // Re-check per-request, not just at selectProvider() time: a model can
    // be uninstalled/removed by the user between selection and this call
    // (e.g. Model Manager UI action mid-session), and isAvailable() being
    // synchronous at selection time means it can't see that. Failing here
    // with a distinguishable error lets provider.js's caller (the Analysis
    // Router) fall through to offline-extractive instead of showing a
    // broken "local LLM" answer.
    if (!modelManager.isAvailable()) {
      throw new Error('local_llm_unavailable');
    }

    const runtime = await getRuntime();

    if (mode === 'generate') {
      // New report generation must not ingest prior report text by default:
      // a previous malformed local draft can otherwise become same-category
      // RAG context and recursively contaminate the next output. Archive
      // retrieval remains available for chat/summarization mode below.
      const contextDocs = [];
      const reportFormat = getReportFormat(category);
      const options = `Öncelik: ${priority}\nAnaliz derinliği: ${depth}` +
        (quantumRequested ? '\nKuantum modu istendi; çevrimdışı kuantum doğrulaması yapılamadığı için yalnızca veriye dayalı klasik analiz üret.' : '');
      const boundedAttachment = String(attachmentContext || '').slice(0, 8000);
      const userText = boundedAttachment
        ? `${reportFormat}\n\nKullanıcının verdiği konu:\n${prompt || title}\n\n${options}\n\nAnalizde kullanılacak yerel dosya/veri içeriği:\n${boundedAttachment}`
        : `${reportFormat}\n\nKullanıcının verdiği konu:\n${prompt || title}\n\n${options}`;
      const fullPrompt = buildPrompt({ instruction: GENERATE_INSTRUCTION, contextDocs, userText, lang });
      const isLowTier = modelManager.spec.tier === 'low';
      // 7B+ quants run several times slower per token than the 1.5B/2-3B
      // tiers on CPU-only inference -- the old flat 90s deadline for
      // "anything not low tier" was tuned for MID (1.5B) and starved a 7B+
      // model (e.g. mistral-7b, high, granite-8b, gemma-9b, phi-14b) of the
      // time it actually needs to finish a 'derin' report, throwing
      // local_llm_timeout even on a capable machine. A first bump to 240s
      // still wasn't enough on real hardware for a 'derin' (1400-token)
      // report on a 7B model -- CPU-only generation at that size can
      // legitimately take several minutes, not seconds. 600s (10 min) is a
      // deliberately generous ceiling: worth the wait for someone who
      // already chose a 7B+ model specifically for its quality over the
      // faster low/mid tiers.
      //
      // Compared on recommendedMinRamBytes, not sizeBytes: different model
      // families quantize to different file sizes for the same parameter
      // class -- mistral-7b's GGUF (4.37GB) is smaller than HIGH's Qwen2.5-7B
      // (4.68GB), so a sizeBytes>=HIGH.sizeBytes check silently classified
      // mistral-7b as NOT large-tier and left it on the 90s deadline through
      // two rounds of "fixes" that never actually applied to it (confirmed
      // via the desktop.log timestamps of a real timeout on mistral-7b: it
      // failed after roughly 90s, not the 240s/600s these comments claimed).
      // recommendedMinRamBytes is set per-tier by intent (see modelSpec.js),
      // not derived from the file, so it doesn't have this problem --
      // mistral-7b/granite-8b/gemma-9b/phi-14b all sit at or above HIGH's
      // 12GB floor.
      const isLargeTier = (modelManager.spec.recommendedMinRamBytes ?? 0) >= HIGH.recommendedMinRamBytes;
      const maxTokens = isLowTier
        ? (depth === 'derin' ? 350 : depth === 'hizli' ? 120 : 220)
        : (depth === 'derin' ? 1400 : depth === 'hizli' ? 650 : 1000);
      const timeoutMs = isLowTier ? 45_000 : isLargeTier ? 600_000 : 90_000;
      const rawContent = await generateWithDeadline(runtime, fullPrompt, { maxTokens, temperature: 0.35 }, timeoutMs);
      const content = cleanReportOutput(rawContent, category);
      // A weak/low-tier model can under-follow instructions badly enough to
      // echo the prompt itself back as its "report" (see reportFormats.js's
      // isPromptEcho) instead of failing outright. Throwing here -- same as
      // the local_llm_unavailable/timeout paths above -- routes this request
      // through provider.js's fallback to offline-extractive instead of
      // handing the user a document made of our own instruction text.
      if (isPromptEcho(content)) {
        throw new Error('local_llm_prompt_echo');
      }
      return {
        type: 'analysis',
        result: {
          title: title || `${category} analizi`,
          content,
          sources: contextDocs.map((d) => ({ id: d.id, title: d.title })),
          quantumRequested,
          quantumVerified: false,
        },
      };
    }

    // Chat mode mirrors offlineExtractive's entityIds convention (1 id =
    // summarize, 2 = compare) but the LLM path answers in free prose
    // instead of returning structured find/summary/compare payloads --
    // ConsultChat's formatLocalAIResult() branches on `type` to render
    // either shape.
    const queryText = text || (entityIds.length ? `Rapor ${entityIds.join(', ')} hakkında` : '');
    const contextDocs = retrieveContext(db, userId, queryText);
    const boundedAttachment = String(attachmentContext || '').slice(0, 8000);
    const userText = boundedAttachment ? `${text}\n\nKullanıcının eklediği yerel dosya içeriği:\n${boundedAttachment}` : text;
    const fullPrompt = buildPrompt({ instruction: CHAT_INSTRUCTION, contextDocs, userText, lang });
    const isLowTier = modelManager.spec.tier === 'low';
    const isLargeTier = (modelManager.spec.recommendedMinRamBytes ?? 0) >= HIGH.recommendedMinRamBytes;
    const chatTimeoutMs = isLowTier ? 35_000 : isLargeTier ? 360_000 : 60_000;
    const answer = await generateWithDeadline(runtime, fullPrompt, { maxTokens: isLowTier ? 120 : 500, temperature: 0.3 }, chatTimeoutMs);
    return {
      type: 'generated',
      text: answer,
      sources: contextDocs.map((d) => ({ id: d.id, title: d.title })),
    };
  }

  run.dispose = async () => {
    await disposeCachedRuntime();
  };

  return run;
}
