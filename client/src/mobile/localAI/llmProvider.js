import { retrieveContext, buildPrompt, SYSTEM_PROMPT } from './rag.js';
import { createLlamaRuntime } from './llmRuntime.js';

const CHAT_INSTRUCTION =
  'Kullanıcının sorusuna, aşağıdaki bağlamı kullanarak Türkçe ve öz bir şekilde cevap ver. ' +
  'Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma.';

const GENERATE_INSTRUCTION =
  'Kullanıcı için istenen konuda, aşağıdaki geçmiş raporlardan faydalanarak yapılandırılmış, başlıklı bir analiz taslağı yaz. ' +
  'Kesin veri yoksa varsayım olduğunu belirt.';

// Resource-safety context cap (task spec point 8). Phone-class contextSize
// is 1536-2048 tokens (modelSpec.js); roughly budgeting ~4 chars/token for
// Turkish/English mixed text, this leaves headroom for the instruction +
// RAG context block + the requested maxTokens output after the user's own
// text is truncated to this length. Truncating here (not just trusting the
// UI to keep input short) means a pasted wall of text can't blow the
// context window and force llama.cpp to either error or silently drop
// context on the native side.
const MAX_INPUT_CHARS = 2000;

function capInput(text) {
  return String(text || '').slice(0, MAX_INPUT_CHARS);
}

// Mirrors desktop/localAI/llmProvider.js -- same request/response shapes,
// same runtimeFactory injection seam, only the underlying runtime differs
// (llmRuntime.js here calls a native Capacitor plugin instead of
// node-llama-cpp).
export function createLLMQuery({ db, userId, modelManager, isInstalled, runtimeFactory = createLlamaRuntime } = {}) {
  let runtimePromise = null;

  function getRuntime() {
    if (!runtimePromise) {
      // A resolvable-on-disk relative path (modelManager's own
      // MODELS_SUBDIR/filename), not just the bare filename -- see
      // modelManager.js's relativePath comment for why. The native plugin
      // resolves this against the app's private storage root itself.
      runtimePromise = runtimeFactory({ modelPath: modelManager.relativePath, contextSize: modelManager.spec.contextSize, systemPrompt: SYSTEM_PROMPT });
    }
    return runtimePromise;
  }

  async function run(request = {}) {
    const { mode = 'chat', text: rawText = '', entityIds = [], category = '', title = '', prompt: rawPrompt = '', lang = 'tr' } = request;
    const text = capInput(rawText);
    const prompt = capInput(rawPrompt);

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
