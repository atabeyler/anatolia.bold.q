import { retrieveContext, buildPrompt, SYSTEM_PROMPT } from './rag.js';
import { createLlamaRuntime } from './llmRuntime.js';

const CHAT_INSTRUCTION =
  'Kullanıcının sorusuna, aşağıdaki bağlamı kullanarak Türkçe ve öz bir şekilde cevap ver. ' +
  'Bağlamda yeterli bilgi yoksa bunu açıkça belirt, bilgi uydurma.';

// Kept deliberately short (2-3 madde, not a long structured report):
// on-device generation speed varies wildly by phone -- a real device was
// observed producing well under 100 tokens within the native 90s wall-clock
// generation deadline (llama-android.cpp), and an ambitious long-report
// instruction meant that budget always ran out mid-sentence/mid-item,
// producing an incoherent, truncated answer. Asking for a short answer the
// model can actually finish (hit its own end-of-turn token) within budget
// produces a shorter but complete and coherent result instead.
const GENERATE_INSTRUCTION =
  'Kullanıcı için istenen konuda, aşağıdaki geçmiş raporlardan faydalanarak KISA (en fazla 2-3 madde) bir analiz taslağı yaz. ' +
  'Her maddeyi tek cümlede tamamla, madde başına dönme. Kesin veri yoksa varsayım olduğunu belirt.';

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
      // 220, not 600: matches GENERATE_INSTRUCTION's new "short, 2-3 item"
      // ask, and stays reachable within the native 90s generation deadline
      // even on a slow device (~1 tok/sec was observed on a real phone) --
      // a maxTokens budget the device can't realistically reach before the
      // deadline just gets cut off mid-sentence regardless of this cap.
      const content = await runtime.generate(fullPrompt, { maxTokens: 220, temperature: 0.4 });
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
