/**
 * ANATOLIA-Q AI Provider Clients
 * Instantiates the three fallback providers (Claude -> Gemini -> OpenAI) via
 * the Vercel AI SDK, each only if its API key is configured. Split out of
 * ai.ts so the provider/model wiring is separate from prompt construction
 * and the generation call flow.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export const anthropicProvider = process.env.ANTHROPIC_API_KEY
  ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
export const googleProvider = process.env.GEMINI_API_KEY
  ? createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
export const openaiProvider = process.env.OPENAI_API_KEY
  ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const MODELS = {
  claudeText: 'claude-sonnet-4-6',
  claudeVoice: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o',
};

export function getStatus(): { claude: boolean; gemini: boolean; openai: boolean } {
  return { claude: !!anthropicProvider, gemini: !!googleProvider, openai: !!openaiProvider };
}
