import { retrieveContext, buildPrompt, SYSTEM_PROMPT } from './rag.js';
import { createLlamaRuntime } from './llmRuntime.js';

const CHAT_INSTRUCTION =
  'Kullanıcının sorusuna, aşağıdaki bağlamı kullanarak Türkçe ve öz bir şekilde cevap ver. ' +
  'Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma.';

const GENERATE_INSTRUCTION =
  'Kullanıcı için istenen konuda, aşağıdaki geçmiş raporlardan faydalanarak yapılandırılmış, başlıklı bir analiz taslağı yaz. ' +
  'Kesin veri yoksa varsayım olduğunu belirt.';

// Mirrors desktop/localAI/llmProvider.js -- same request/response shapes,
// same runtimeFactory injection seam, only the underlying runtime differs
// (llmRuntime.js here calls a native Capacitor plugin instead of
// node-llama-cpp).
export function createLLMQuery({ db, userId, modelManager, isInstalled, runtimeFactory = createLlamaRuntime } = {}) {
  let runtimePromise = null;

  function getRuntime() {
    if (!runtimePromise) {
      runtimePromise = runtimeFactory({ modelPath: modelManager.spec.filename, contextSize: modelManager.spec.contextSize, systemPrompt: SYSTEM_PROMPT });
    }
    return runtimePromise;
  }

  async function run(request = {}) {
    const { mode = 'chat', text = '', entityIds = [], category = '', title = '', prompt = '', lang = 'tr' } = request;

    if (!modelManager.isAvailableSync(isInstalled)) {
      throw new Error('local_llm_unavailable');
    }

    const runtime = await getRuntime();

    if (mode === 'generate') {
      const queryText = `${category} ${title} ${prompt}`.trim();
      const contextDocs = await retrieveContext(db, userId, queryText);
      const fullPrompt = buildPrompt({ instruction: GENERATE_INSTRUCTION, contextDocs, userText: prompt || title, lang });
      const content = await runtime.generate(fullPrompt, { maxTokens: 600, temperature: 0.4 });
      return {
        type: 'analysis',
        result: { title: title || `${category} analizi`, content, sources: contextDocs.map((d) => ({ id: d.id, title: d.title })) },
      };
    }

    const queryText = text || (entityIds.length ? `Rapor ${entityIds.join(', ')} hakkında` : '');
    const contextDocs = await retrieveContext(db, userId, queryText);
    const fullPrompt = buildPrompt({ instruction: CHAT_INSTRUCTION, contextDocs, userText: text, lang });
    const answer = await runtime.generate(fullPrompt, { maxTokens: 350, temperature: 0.3 });
    return { type: 'generated', text: answer, sources: contextDocs.map((d) => ({ id: d.id, title: d.title })) };
  }

  run.dispose = async () => {
    if (!runtimePromise) return;
    const runtime = await runtimePromise;
    runtimePromise = null;
    await runtime.dispose?.();
  };

  return run;
}
