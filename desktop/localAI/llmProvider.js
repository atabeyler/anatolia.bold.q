import { retrieveContext, buildPrompt, SYSTEM_PROMPT } from './rag.js';
import { createLlamaRuntime } from './llmRuntime.js';

const CHAT_INSTRUCTION =
  'Kullanıcının sorusuna, aşağıdaki bağlamı kullanarak Türkçe ve öz bir şekilde cevap ver. ' +
  'Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma.';

const GENERATE_INSTRUCTION =
  'Kullanıcı için istenen konuda, aşağıdaki geçmiş raporlardan faydalanarak yapılandırılmış, başlıklı bir analiz taslağı yaz. ' +
  'Bu taslağın çevrimdışı bir yerel model tarafından üretildiğini ima eden ifadeler kullanma; sadece içeriğe odaklan. ' +
  'Kesin veri yoksa varsayım olduğunu belirt.';

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

  function getRuntime() {
    if (!runtimePromise) {
      runtimePromise = runtimeFactory({ modelPath: modelManager.modelPath, contextSize: modelManager.spec.contextSize, systemPrompt: SYSTEM_PROMPT });
    }
    return runtimePromise;
  }

  async function run(request = {}) {
    const { mode = 'chat', text = '', entityIds = [], category = '', title = '', prompt = '', lang = 'tr' } = request;

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
      const queryText = `${category} ${title} ${prompt}`.trim();
      const contextDocs = retrieveContext(db, userId, queryText);
      const fullPrompt = buildPrompt({ instruction: GENERATE_INSTRUCTION, contextDocs, userText: prompt || title, lang });
      const content = await runtime.generate(fullPrompt, { maxTokens: 900, temperature: 0.4 });
      return {
        type: 'analysis',
        result: {
          title: title || `${category} analizi`,
          content,
          sources: contextDocs.map((d) => ({ id: d.id, title: d.title })),
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
    const fullPrompt = buildPrompt({ instruction: CHAT_INSTRUCTION, contextDocs, userText: text, lang });
    const answer = await runtime.generate(fullPrompt, { maxTokens: 500, temperature: 0.3 });
    return {
      type: 'generated',
      text: answer,
      sources: contextDocs.map((d) => ({ id: d.id, title: d.title })),
    };
  }

  run.dispose = async () => {
    if (!runtimePromise) return;
    const runtime = await runtimePromise;
    runtimePromise = null;
    await runtime.dispose?.();
  };

  return run;
}
