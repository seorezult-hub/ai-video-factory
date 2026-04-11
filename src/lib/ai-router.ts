/**
 * AI Model Router
 *
 * Правила:
 * - Дешёвая модель по умолчанию, дорогая только если нужна
 * - JSON mode включён всегда (eliminates parsing errors)
 * - Конкретные модели зафиксированы (version pinning)
 *
 * classify  → Gemini Flash-Lite  (200 токенов, t=0.1)
 * extract   → Gemini Flash-Lite  (1000 токенов, t=0.2)
 * questions → Gemini Flash-Lite  (600 токенов, t=0.4)
 * analyze   → Gemini Flash       (1500 токенов, t=0.3)
 * script    → Gemini Flash       (2500 токенов, t=0.7)
 * judge     → Groq LLaMA 70b     (400 токенов, t=0.1) — всегда другой провайдер
 */

export type TaskType = "classify" | "extract" | "questions" | "analyze" | "script" | "judge";

import { registry } from "./model-registry";

// OpenRouter — единый провайдер для Claude + Gemini (OpenAI-совместимый формат)
async function callOpenRouter(opts: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!opts.apiKey) return { ok: false, text: "", error: "OPENROUTER_API_KEY not set" };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-video-factory.app",
        "X-Title": "AI Video Factory",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "60");
      registry.recordRateLimit("openrouter", retryAfter);
      return { ok: false, text: "", error: `OpenRouter rate limited for ${retryAfter}s` };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (text) {
      registry.recordSuccess("openrouter");
      return { ok: true, text: text.trim() };
    }
    registry.recordError("openrouter", data.error?.message ?? "Empty OpenRouter response");
    return { ok: false, text: "", error: data.error?.message ?? "Empty OpenRouter response" };
  } catch (e) {
    registry.recordError("openrouter", String(e));
    return { ok: false, text: "", error: String(e) };
  }
}

// Прямой Claude API (fallback если OpenRouter недоступен)
async function callClaude(opts: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!opts.apiKey) return { ok: false, text: "", error: "ANTHROPIC_API_KEY not set" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (text) return { ok: true, text: text.trim() };
    return { ok: false, text: "", error: data.error?.message ?? "Empty Claude response" };
  } catch (e) {
    return { ok: false, text: "", error: String(e) };
  }
}

interface CallOptions {
  task: TaskType;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean; // по умолчанию true для всех задач кроме script
  apiKeys?: {
    gemini?: string;
    groq?: string;
    openrouter?: string;
  };
}

export interface RouterResult {
  ok: boolean;
  text: string;
  model: string;
  provider: "gemini" | "groq" | "claude" | "none";
  error?: string;
}

// Зафиксированные версии моделей — не меняем без явного решения
const PINNED_MODELS = {
  gemini: {
    fast: "gemini-2.0-flash-lite",        // classify, extract, questions
    standard: "gemini-2.0-flash",          // analyze
    powerful: "gemini-2.5-flash",          // script primary + эскалация
  },
  groq: {
    fast: "llama-3.1-8b-instant",          // judge простых задач
    standard: "llama-3.3-70b-versatile",   // judge сложных задач + fallback
  },
};

const TASK_CONFIG: Record<
  TaskType,
  { provider: "gemini" | "groq"; model: string; maxTokens: number; temperature: number; jsonMode: boolean }
> = {
  // Groq LLaMA везде где нет Gemini — бесплатно, быстро, надёжно
  classify:  { provider: "groq", model: PINNED_MODELS.groq.fast,     maxTokens: 200,  temperature: 0.1, jsonMode: true  },
  extract:   { provider: "groq", model: PINNED_MODELS.groq.standard, maxTokens: 1000, temperature: 0.2, jsonMode: true  },
  questions: { provider: "groq", model: PINNED_MODELS.groq.standard, maxTokens: 600,  temperature: 0.4, jsonMode: true  },
  analyze:   { provider: "groq", model: PINNED_MODELS.groq.standard, maxTokens: 1500, temperature: 0.3, jsonMode: true  },
  script:    { provider: "groq", model: PINNED_MODELS.groq.standard, maxTokens: 2500, temperature: 0.7, jsonMode: false }, // Claude через OpenRouter — приоритет (см. aiCall)
  judge:     { provider: "groq", model: PINNED_MODELS.groq.standard, maxTokens: 400,  temperature: 0.1, jsonMode: true  },
};

// Эскалация: если стандартная модель не справилась
const ESCALATION_MODEL: Partial<Record<TaskType, string>> = {
  script:  PINNED_MODELS.gemini.powerful,
  analyze: PINNED_MODELS.gemini.powerful,
  extract: PINNED_MODELS.gemini.standard,
};

export async function aiCall(opts: CallOptions): Promise<RouterResult> {
  const config = TASK_CONFIG[opts.task];
  const maxTokens = opts.maxTokens ?? config.maxTokens;
  const temperature = opts.temperature ?? config.temperature;
  const jsonMode = opts.jsonMode ?? config.jsonMode;

  const geminiKey = opts.apiKeys?.gemini ?? process.env.GEMINI_API_KEY ?? "";
  const groqKey = opts.apiKeys?.groq ?? process.env.GROQ_API_KEY ?? "";
  const orKey = opts.apiKeys?.openrouter ?? process.env.OPENROUTER_API_KEY;

  // Script: Claude Sonnet через OpenRouter ПЕРВЫМ — максимальное качество сценариев
  if (opts.task === "script" && orKey) {
    const claudeResult = await callOpenRouter({
      model: "anthropic/claude-sonnet-4-6",
      apiKey: orKey,
      system: opts.system,
      user: opts.user,
      maxTokens,
      temperature,
    });
    if (claudeResult.ok) return { ...claudeResult, model: "anthropic/claude-sonnet-4-6", provider: "claude" };
  }

  // Все задачи кроме script → Groq primary, OpenRouter Claude как fallback
  const groqResult = await callGroq({
    model: config.model,
    apiKey: groqKey,
    system: opts.system,
    user: opts.user,
    maxTokens,
    temperature,
    jsonMode,
  });
  if (groqResult.ok) return { ...groqResult, model: config.model, provider: "groq" };

  // Fallback: OpenRouter Claude Haiku
  if (orKey) {
    const orResult = await callOpenRouter({
      model: "anthropic/claude-haiku-3-5",
      apiKey: orKey,
      system: opts.system,
      user: opts.user,
      maxTokens,
      temperature,
    });
    if (orResult.ok) return { ...orResult, model: "anthropic/claude-haiku-3-5", provider: "claude" };
  }

  return { ok: false, text: "", model: "none", provider: "none", error: groqResult.error };
}

// Эскалированный вызов — для script: Claude Sonnet через OpenRouter
export async function aiCallEscalated(opts: Omit<CallOptions, "task"> & { task: TaskType }): Promise<RouterResult> {
  const config = TASK_CONFIG[opts.task];
  const maxTokens = opts.maxTokens ?? config.maxTokens;
  const temperature = opts.temperature ?? config.temperature;

  const geminiKey = opts.apiKeys?.gemini ?? process.env.GEMINI_API_KEY ?? "";

  // Script эскалация → Claude Sonnet (OpenRouter)
  if (opts.task === "script") {
    const orKey = opts.apiKeys?.openrouter ?? process.env.OPENROUTER_API_KEY;
    if (orKey) {
      const result = await callOpenRouter({
        model: "anthropic/claude-sonnet-4-6",
        apiKey: orKey,
        system: opts.system,
        user: opts.user,
        maxTokens,
        temperature,
      });
      if (result.ok) return { ...result, model: "anthropic/claude-sonnet-4-6", provider: "claude" };
    }
  }

  // Эскалация для всех задач → Claude Sonnet (OpenRouter)
  const orKeyEsc = opts.apiKeys?.openrouter ?? process.env.OPENROUTER_API_KEY;
  if (orKeyEsc) {
    const result = await callOpenRouter({
      model: "anthropic/claude-sonnet-4-6",
      apiKey: orKeyEsc,
      system: opts.system,
      user: opts.user,
      maxTokens,
      temperature,
    });
    if (result.ok) return { ...result, model: "anthropic/claude-sonnet-4-6", provider: "claude" };
  }
  return { ok: false, text: "", model: "none", provider: "none", error: "All providers failed" };
}

async function callGemini(opts: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  jsonMode: boolean;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!opts.apiKey) return { ok: false, text: "", error: "GEMINI_API_KEY not set" };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          generationConfig: {
            temperature: opts.temperature,
            maxOutputTokens: opts.maxTokens,
            // JSON mode — убирает парсинг-ошибки для структурированных задач
            ...(opts.jsonMode && { responseMimeType: "application/json" }),
          },
        }),
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return { ok: true, text: text.trim() };
    const reason = data.candidates?.[0]?.finishReason;
    return { ok: false, text: "", error: data.error?.message ?? reason ?? "Empty Gemini response" };
  } catch (e) {
    return { ok: false, text: "", error: String(e) };
  }
}

async function callGroq(opts: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  jsonMode?: boolean;
}): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!opts.apiKey) return { ok: false, text: "", error: "GROQ_API_KEY not set" };
  try {
    // BUG-039: AbortSignal.timeout для Groq
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        ...(opts.jsonMode !== false ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "60");
      registry.recordRateLimit("groq", retryAfter);
      return { ok: false, text: "", error: `Groq rate limited for ${retryAfter}s` };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (text) {
      registry.recordSuccess("groq");
      return { ok: true, text: text.trim() };
    }
    registry.recordError("groq", data.error?.message ?? "Empty Groq response");
    return { ok: false, text: "", error: data.error?.message ?? "Empty Groq response" };
  } catch (e) {
    registry.recordError("groq", String(e));
    return { ok: false, text: "", error: String(e) };
  }
}

// Хелпер: безопасный парсинг JSON (работает с JSON mode — нет markdown обёрток)
export function parseJSON<T>(text: string): T | null {
  // Сначала убираем markdown code blocks (```json ... ``` или ``` ... ```)
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Ищем массив первым (для script), потом объект
    const arrMatch = stripped.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]) as T; } catch { /* fall through */ }
    }
    const objMatch = stripped.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) as T; } catch { /* fall through */ }
    }
    return null;
  }
}
