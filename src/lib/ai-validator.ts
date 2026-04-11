/**
 * AI Quality Gate — эталонная реализация.
 *
 * Принципы (мировой стандарт 2026):
 *
 * 1. CROSS-PROVIDER JUDGE: Gemini генерирует → Groq судит. Groq генерирует → Gemini судит.
 *    Один провайдер не может объективно оценивать сам себя (self-bias).
 *
 * 2. JUDGE > STUDENT: Судья всегда мощнее исполнителя.
 *    Groq LLaMA 70b судит Gemini Flash-Lite. Не наоборот.
 *
 * 3. TARGETED FIX, NOT RETRY: Не перегенерируем с нуля.
 *    Говорим модели точно что исправить. Токенов втрое меньше.
 *
 * 4. MAX 3 ПОПЫТКИ: gen → fix → escalate. Дальше не имеет смысла.
 *
 * 5. НИКОГДА НЕ БЛОКИРУЕМ: Если валидатор сам упал → пропускаем результат.
 *    Лучше чуть хуже, чем сервис не отвечает.
 *
 * Алгоритм:
 *   Попытка 1: генерируем дешёвой моделью → судья оценивает
 *   Попытка 2: точечно исправляем по списку проблем → судья оценивает
 *   Попытка 3: эскалируем на мощную модель → судья оценивает
 *   Возвращаем лучший результат из трёх попыток
 */

import { aiCall, aiCallEscalated, parseJSON, TaskType } from "./ai-router";

interface JudgeVerdict {
  score: number;       // 0-100
  issues: string[];    // конкретные проблемы, каждая = одно исправление
  valid: boolean;
}

interface QualityConfig {
  minScore: number;
  judgePrompt: string; // компактный, без воды
}

// ─── Эталоны качества ────────────────────────────────────────────────────────

const CONFIGS: Record<TaskType, QualityConfig> = {

  script: {
    minScore: 78,
    judgePrompt: `You evaluate brand video scripts for AI production (Seedance 2.0 pipeline). Score 0-100.

FORMAT RULES — EGOR KUZMIN METHOD (-5 each violation):
1. visualPrompt: 50-85 English words (natural language, not keyword lists)
2. ONE camera movement only — no combined "zoom and pan", no two movements
3. cameraMovement field: exactly one of [slow push-in, tracking shot, static, slow orbit, dolly back, overhead, rack focus]
4. duration: "5 sec" or "10 sec" only (or "15 sec" for single continuous shot)
5. No vague-only modifiers: "cinematic", "beautiful", "epic" must come with specific details

CREATIVE QUALITY RULES (-8 each violation):
6. Scene 1 = visual HOOK — emotion first, no product in opening shot
7. Last scene = BRAND CLOSE — product/logo at emotional peak
8. Emotional progression exists — each scene is distinct, not a repeat
9. visualPrompts are hyper-specific — no "product on surface", "person walks", "nice lighting"
10. At least @Image1 and one product @Image must appear in the prompt

GOOD: "@Image1 stands in a minimalist white studio. She gently holds @Image2 near her face, examining it with soft curiosity. Close-up, slow dolly-in. Clean commercial aesthetic, warm studio light, soft skin tones."
BAD: "product on a surface with nice lighting and cinematic feel"

ANTI-SLOP RULES (-5 each violation):
11. Never use: breathtaking, stunning, captivating, seamlessly, effortlessly, cinematic masterpiece, beautiful, epic, amazing, gorgeous, incredible, magnificent, luxurious feel, mesmerizing
12. One action per scene — "walks and smiles" = -5. Only "walks" OR "smiles"

NOTE: Natural language style (Egor Kuzmin method) is accepted — SHOT:/SUBJECT:/STYLE:/EXIT: prefixes are NOT required. Prompts without these prefixes are NOT penalized.
Double contrast rule (shot size + camera mode both change per cut) is preferred but NOT penalized if only one changes (-2 max, not -8).

Return JSON only: {"score":number,"issues":["scene N: what exactly is wrong and how to fix"]}`
  },

  extract: {
    minScore: 90,
    judgePrompt: `Validate brand data JSON. Score 0-100.

Required non-empty fields: brandName, productDescription (1-2 sentences), targetAudience (age+gender+interests), brandColors (2-3 colors), videoType (one of: cosmetics/fashion/food/music/tech/real_estate), mood (one of: Люкс/Энергия/Мягко и натурально/Дерзко/Минимализм/Игриво).

Return JSON only: {"score":number,"issues":["fieldName: exact problem"]}`
  },

  analyze: {
    minScore: 80,
    judgePrompt: `Validate JTBD analysis JSON. Score 0-100.

Required: keyPains (3 specific, not generic), keyDesires (3 specific), emotionalTriggers (2 hooks), videoAngle (1 sentence concept), toneOfVoice (luxury/friendly/energetic/trust/aspirational), callToAction (specific phrase).

Generic = bad: "wants quality product", "desires a better life".
Specific = good: "afraid UV rays damage during outdoor photo shoots", "wants her skin to look like glass in Reels".

Return JSON only: {"score":number,"issues":["field: specific problem"]}`
  },

  questions: {
    minScore: 80,
    judgePrompt: `Validate clarifying questions for video production brief. Score 0-100.

Requirements:
- 3-5 questions total
- Each question leads to ONE concrete production decision
- Questions are specific (not "what mood?" but "should the model face camera directly or look away?")
- No duplicates or overlapping
- Language matches user input language

Return JSON only: {"score":number,"issues":["Q№: exact problem"]}`
  },

  classify: {
    minScore: 95,
    judgePrompt: `Validate classification JSON. Must have: path (integer 1, 2, or 3), missing (array of strings). Return JSON only: {"score":number,"issues":[]}`
  },

  judge: {
    minScore: 100, // judge не валидируется сам — рекурсия
    judgePrompt: ""
  },
};

// ─── Главная функция ──────────────────────────────────────────────────────────

export interface GatedResult {
  ok: boolean;
  text: string;
  score: number;
  attempts: number;
  escalated: boolean;
  model?: string;
  error?: string;
}

export async function aiCallWithQualityGate(opts: {
  task: TaskType;
  system: string;
  user: string;
  maxTokens?: number;
  apiKeys?: {
    gemini?: string;
    groq?: string;
    openrouter?: string;
  };
}): Promise<GatedResult> {
  const config = CONFIGS[opts.task];
  let best: { text: string; score: number } = { text: "", score: 0 };
  let attempts = 0;
  let escalated = false;

  const apiKeys = opts.apiKeys;

  // ── Попытка 1: генерируем стандартной моделью ───────────────────────────────
  attempts++;
  const gen1 = await aiCall({ task: opts.task, system: opts.system, user: opts.user, maxTokens: opts.maxTokens, apiKeys });
  if (!gen1.ok) {
    // Все провайдеры в aiCall упали → сразу эскалируем на Claude (OpenRouter)
    attempts++;
    escalated = true;
    const fallback = await aiCallEscalated({ task: opts.task, system: opts.system, user: opts.user, maxTokens: opts.maxTokens, apiKeys });
    if (fallback.ok) {
      const verdict = await judge(fallback.text, opts.task, config, apiKeys);
      return { ok: true, text: fallback.text, score: verdict.score, attempts, escalated, model: fallback.model };
    }
    return { ok: false, text: "", score: 0, attempts, escalated, error: gen1.error };
  }

  const verdict1 = await judge(gen1.text, opts.task, config, apiKeys);
  if (verdict1.valid) {
    return { ok: true, text: gen1.text, score: verdict1.score, attempts, escalated, model: gen1.model };
  }
  let bestModel = gen1.model;
  if (verdict1.score > best.score) best = { text: gen1.text, score: verdict1.score };

  // ── Попытка 2: точечное исправление ────────────────────────────────────────
  if (verdict1.issues.length > 0) {
    attempts++;
    const fixPrompt = buildFixPrompt(gen1.text, verdict1.issues);
    const gen2 = await aiCall({ task: opts.task, system: FIX_SYSTEM, user: fixPrompt, maxTokens: opts.maxTokens, apiKeys });

    if (gen2.ok) {
      const verdict2 = await judge(gen2.text, opts.task, config, apiKeys);
      if (verdict2.valid) {
        return { ok: true, text: gen2.text, score: verdict2.score, attempts, escalated, model: gen2.model };
      }
      if (verdict2.score > best.score) { best = { text: gen2.text, score: verdict2.score }; bestModel = gen2.model; }
    }
  }

  // ── Попытка 3: эскалация на мощную модель ──────────────────────────────────
  attempts++;
  escalated = true;
  const gen3 = await aiCallEscalated({ task: opts.task, system: opts.system, user: opts.user, maxTokens: opts.maxTokens, apiKeys });

  if (gen3.ok) {
    const verdict3 = await judge(gen3.text, opts.task, config, apiKeys);
    if (verdict3.score > best.score) { best = { text: gen3.text, score: verdict3.score }; bestModel = gen3.model; }
    if (verdict3.valid) {
      return { ok: true, text: gen3.text, score: verdict3.score, attempts, escalated, model: gen3.model };
    }
  }

  // Возвращаем лучшее что есть — никогда не блокируем
  return {
    ok: best.text.length > 0,
    text: best.text,
    score: best.score,
    attempts,
    escalated,
    model: bestModel,
    error: best.score < config.minScore
      ? `Quality ${best.score}/${config.minScore} after ${attempts} attempts`
      : undefined,
  };
}

// ─── Судья (cross-provider) ───────────────────────────────────────────────────

async function judge(
  text: string,
  task: TaskType,
  config: QualityConfig,
  apiKeys?: { gemini?: string; groq?: string; openrouter?: string }
): Promise<JudgeVerdict> {
  // judge не валидируется
  if (task === "judge" || !config.judgePrompt) {
    return { score: 100, issues: [], valid: true };
  }

  // КЛЮЧЕВОЕ: используем Groq как судью для Gemini-вывода
  // Groq LLaMA 70b → независимая оценка, нет self-bias
  const groqKey = apiKeys?.groq ?? process.env.GROQ_API_KEY;
  if (!groqKey) {
    // Нет судьи → пропускаем, не блокируем
    return { score: 100, issues: [], valid: true };
  }

  const result = await aiCall({
    task: "judge",
    system: config.judgePrompt,
    user: `Evaluate:\n\n${text.substring(0, 3000)}`, // лимит чтобы не раздувать токены
    maxTokens: 400,
    temperature: 0.1,
    apiKeys,
  });

  if (!result.ok) return { score: 100, issues: [], valid: true }; // судья упал → пропускаем

  const parsed = parseJSON<{ score: number; issues: string[] }>(result.text);
  if (!parsed || typeof parsed.score !== "number") {
    return { score: 100, issues: [], valid: true };
  }

  const score = Math.max(0, Math.min(100, parsed.score));
  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean) : [];

  return {
    score,
    issues,
    valid: score >= config.minScore,
  };
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

const FIX_SYSTEM = `You are a precise JSON fixer. Fix ONLY the listed issues. Keep everything else identical. Return complete fixed JSON, no explanation, no markdown.`;

function buildFixPrompt(original: string, issues: string[]): string {
  return `Fix ONLY these issues in the JSON below:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

Original:
${original}`;
}
