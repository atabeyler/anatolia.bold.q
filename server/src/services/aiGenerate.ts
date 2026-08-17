/**
 * ANATOLIA-Q AI Generation Calls
 * Triple-provider fallback (Claude -> Gemini -> OpenAI) for one-shot
 * generation, vision, streaming consultation, and structured voice-intent
 * parsing. Split out of ai.ts, which mixed this call-flow logic with
 * provider client setup and system-prompt construction.
 */
import { generateText, generateObject, streamText } from 'ai';
import { z } from 'zod';
import type { Response } from 'express';
import { logger } from '../lib/logger.js';
import { recordRequestMetric } from '../lib/requestMetrics.js';
import { anthropicProvider, googleProvider, openaiProvider, MODELS } from './aiProviders.js';

// Records latency + success/failure for one provider attempt, keyed
// `ai.<provider>` -- see getMetricsSnapshot()/the /api/platform/metrics
// endpoint. Comparing call counts across providers over time surfaces the
// Claude -> Gemini -> OpenAI fallback rate without a separate counter.
function recordAiAttempt(provider: string, startedAt: number, ok: boolean) {
  recordRequestMetric(`ai.${provider}`, Date.now() - startedAt, ok ? 200 : 500);
}

interface AttemptDef {
  name: string;
  model: any; // concrete model types differ per provider
}

interface GenerateResult {
  provider: string;
  content: string;
  usage: unknown;
}

// Thrown when every AI provider fails. The Turkish `message` is kept for
// logs and direct API callers, but the client never shows it raw -- it's
// not routed through the i18n system like the rest of the UI, so it would
// display in Turkish regardless of the user's selected app language. The
// `code` lets client code substitute a properly localized string instead
// (see AnalysisView.jsx / ConsultChat.jsx).
export class AllProvidersFailedError extends Error {
  code = 'ALL_AI_PROVIDERS_FAILED';
}

export async function generateAnalysisWithVision(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  imageMimetype: string
): Promise<GenerateResult> {
  if (anthropicProvider) {
    try {
      const { text, usage } = await generateText({
        model: anthropicProvider(MODELS.claudeText),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: imageBase64, mediaType: imageMimetype },
              { type: 'text', text: userPrompt },
            ],
          },
        ],
        maxOutputTokens: 8000,
      });
      return { provider: 'Claude Vision (Anthropic)', content: text, usage };
    } catch (err) {
      logger.warn({ err }, 'Claude Vision failed -> falling back to text');
    }
  }
  return generateAnalysis(systemPrompt, `[Görsel eklendi — görsel AI kullanılamıyor]\n\n${userPrompt}`);
}

export async function generateAnalysis(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
  const errors: Array<{ provider: string; error: string }> = [];

  if (anthropicProvider) {
    const startedAt = Date.now();
    try {
      const { text, usage } = await generateText({
        model: anthropicProvider(MODELS.claudeText),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 8000,
      });
      recordAiAttempt('claude', startedAt, true);
      return { provider: 'Claude (Anthropic)', content: text, usage };
    } catch (err) {
      recordAiAttempt('claude', startedAt, false);
      logger.warn({ err }, 'Claude failed -> Gemini');
      errors.push({ provider: 'claude', error: (err as Error).message });
    }
  }

  if (googleProvider) {
    const startedAt = Date.now();
    try {
      const { text } = await generateText({
        model: googleProvider(MODELS.gemini),
        system: systemPrompt,
        prompt: userPrompt,
      });
      recordAiAttempt('gemini', startedAt, true);
      return { provider: 'Gemini (Google)', content: text, usage: null };
    } catch (err) {
      recordAiAttempt('gemini', startedAt, false);
      logger.warn({ err }, 'Gemini failed -> OpenAI');
      errors.push({ provider: 'gemini', error: (err as Error).message });
    }
  }

  if (openaiProvider) {
    const startedAt = Date.now();
    try {
      const { text, usage } = await generateText({
        model: openaiProvider.chat(MODELS.openai),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 8000,
      });
      recordAiAttempt('openai', startedAt, true);
      return { provider: 'GPT-4o (OpenAI)', content: text, usage };
    } catch (err) {
      recordAiAttempt('openai', startedAt, false);
      errors.push({ provider: 'openai', error: (err as Error).message });
    }
  }

  throw new AllProvidersFailedError(`Tüm AI sağlayıcılar başarısız: ${JSON.stringify(errors)}`);
}

/**
 * Real-time streaming for consultation chat. Providers are tried in order;
 * if a provider errors before producing its first chunk, the next one is
 * tried. Once writing has started (res.writeHead has been called), the
 * provider can no longer be switched — any error after that point ends the
 * stream where it is.
 */
export async function streamConsultationText(
  systemPrompt: string,
  userPrompt: string,
  res: Response
): Promise<{ provider: string; content: string }> {
  const attempts: AttemptDef[] = [
    anthropicProvider ? { name: 'Claude (Anthropic)', model: anthropicProvider(MODELS.claudeText) } : null,
    googleProvider ? { name: 'Gemini (Google)', model: googleProvider(MODELS.gemini) } : null,
    openaiProvider ? { name: 'GPT-4o (OpenAI)', model: openaiProvider.chat(MODELS.openai) } : null,
  ].filter((x): x is AttemptDef => x !== null);

  for (const attempt of attempts) {
    const startedAt = Date.now();
    const metricKey = attempt.name.startsWith('Claude') ? 'claude' : attempt.name.startsWith('Gemini') ? 'gemini' : 'openai';
    let startedSending = false;
    let full = '';
    try {
      const result = streamText({ model: attempt.model, system: systemPrompt, prompt: userPrompt });
      for await (const chunk of result.textStream) {
        if (!startedSending) {
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-AI-Provider': encodeURIComponent(attempt.name),
            'Cache-Control': 'no-cache',
          });
          startedSending = true;
        }
        full += chunk;
        res.write(chunk);
      }
      if (!startedSending) {
        // The stream completed with zero chunks and no thrown exception --
        // some providers (e.g. Anthropic on a billing/credit failure)
        // surface the error this way instead of rejecting the async
        // iterator. Without this check that looks like a silent, empty
        // "success" on the first attempt and never falls back to the next
        // provider, leaving the client with a 200 response and no body.
        recordAiAttempt(metricKey, startedAt, false);
        logger.warn({ provider: attempt.name }, 'Stream produced no output, trying next provider');
        continue;
      }
      recordAiAttempt(metricKey, startedAt, true);
      res.end();
      return { provider: attempt.name, content: full };
    } catch (err) {
      recordAiAttempt(metricKey, startedAt, false);
      if (startedSending) {
        // Data has already been sent to the client — no choice but to end the stream here.
        logger.warn({ err, provider: attempt.name }, 'Streaming cut short');
        res.end();
        return { provider: attempt.name, content: full };
      }
      logger.warn({ err, provider: attempt.name }, 'Failed to start streaming, trying next provider');
    }
  }

  throw new AllProvidersFailedError('Tüm AI sağlayıcılar başarısız');
}

const voiceIntentSchema = z.object({
  actions: z.array(z.object({
    action: z.string(),
    params: z.record(z.string(), z.any()).optional().default({}),
  })),
  speak: z.string(),
});

export type VoiceIntentResult = z.infer<typeof voiceIntentSchema>;

// Uses generateObject (provider-native structured output) instead of free-text
// generation + manual JSON.parse -- the previous approach broke whenever a model
// wrapped its reply in prose/markdown or emitted an unescaped character, which
// made the voice assistant fall back to "could not understand" far too often.
export async function parseVoiceIntent(systemPrompt: string, userMessage: string): Promise<VoiceIntentResult> {
  if (anthropicProvider) {
    try {
      const { object } = await generateObject({
        model: anthropicProvider(MODELS.claudeVoice),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] Claude failed, trying Gemini');
    }
  }

  if (googleProvider) {
    try {
      const { object } = await generateObject({
        model: googleProvider(MODELS.gemini),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] Gemini failed, trying GPT-4o');
    }
  }

  if (openaiProvider) {
    try {
      const { object } = await generateObject({
        model: openaiProvider.chat(MODELS.openai),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] GPT-4o also failed');
    }
  }

  // AllProvidersFailedError (not a plain Error) so callers that switch on
  // err.code === 'ALL_AI_PROVIDERS_FAILED' (client/src/services/api.js,
  // ConsultChat.jsx) also catch a total voice-intent failure consistently
  // with generateAnalysis/streamConsultationText above.
  throw new AllProvidersFailedError('Tüm AI sağlayıcılar başarısız');
}
