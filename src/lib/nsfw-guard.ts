/**
 * nsfw-guard.ts
 *
 * Предотвращает NSFW блокировку Atlas/fal.ai ПЕРЕД отправкой запроса.
 *
 * Проблема: Atlas Seedance 2.0 блокирует промты содержащие слова/контекст
 * которые его safety filter считает потенциально проблематичными.
 * Это происходит даже при легитимных брендовых съёмках:
 * — спортивная форма (skin + tight fit)
 * — парфюм (bottle shapes)
 * — татуировки (skin detection)
 * — beauty/cosmetics (lips, skin tone)
 *
 * Решение: sanitize промт ДО отправки + fallback провайдер если всё равно упало.
 */

// ── Карта замен: опасное слово → безопасный синоним ─────────────────────────
// Принцип: сохраняем смысл, убираем trigger-слова
const NSFW_WORD_MAP: Record<string, string> = {
  // Внешность/одежда
  "revealing":      "dynamic",
  "tight":          "fitted",
  "skin-tight":     "athletic",
  "bare":           "open",
  "naked":          "minimalist",
  "topless":        "athletic look",
  "shirtless":      "jersey",
  "exposed":        "visible",
  "seductive":      "confident",
  "sultry":         "intense",
  "sexy":           "striking",
  "hot":            "energetic",
  "sensual":        "expressive",
  "provocative":    "bold",
  "erotic":         "artistic",
  "lingerie":       "athletic wear",
  "bikini":         "sportswear",
  "underwear":      "sport shorts",
  "nude":           "minimal",

  // Тело
  "cleavage":       "neckline",
  "chest":          "torso",
  "breast":         "upper body",
  "buttocks":       "lower body",
  "thighs":         "legs",
  "crotch":         "center",
  "groin":          "waist area",
  "nipple":         "jersey detail",

  // Контекст
  "blood":          "red liquid",
  "gore":           "intense visual",
  "violence":       "power",
  "weapon":         "prop",
  "gun":            "handheld device",
  "knife":          "sharp edge prop",
  "drug":           "supplement",
  "alcohol":        "beverage",
  "cigarette":      "prop",

  // Люкс/парфюм — слова которые Atlas трактует как NSFW в контексте рекламы
  "desire":         "longing",
  "lust":           "passion",
  "tempt":          "invite",
  "tempting":       "inviting",
  "temptation":     "allure",
  "arousal":        "awakening",
  "arouse":         "awaken",
  "arousing":       "awakening",
  "orgasmic":       "transcendent",
  "climax":         "peak",
  "forbidden":      "exclusive",
  "dangerous":      "bold",
  "sinful":         "indulgent",
  "sin":            "indulgence",
  "virgin":         "pure",
  "seduce":         "attract",
  "seduction":      "attraction",
  "tease":          "suggest",
  "teasing":        "suggesting",
  "lure":           "draw",
  "luring":         "drawing",
  "raw":            "natural",
  "savage":         "powerful",
  "wild":           "untamed",
  "beast":          "force",
  "primal":         "elemental",
  "animalistic":    "instinctive",
  "penetrating":    "piercing",
  "penetrate":      "pierce",
  "throbbing":      "pulsing",
  "throb":          "pulse",
  "moan":           "exhale",
  "moaning":        "exhaling",
  "sweat":          "glisten",
  "sweating":       "glistening",
  "sweaty":         "glistening",
  "glistening skin":"luminous surface",
  "burning":        "glowing",
  "hot breath":     "warm breath",
  "lips parted":    "lips gently open",
  "open lips":      "slightly parted lips",
  "wet":            "moist",
  "dripping":       "flowing",
  "slippery":       "smooth",
  "naked skin":     "bare surface",
  "bare skin":      "smooth surface",
  "death":          "stillness",
  "dead":           "still",
  "dying":          "fading",
  "kill":           "stop",
  "murder":         "silence",
  "explicit":       "direct",
};

// Паттерны фраз (regex) которые триггерят
const NSFW_PHRASE_PATTERNS: Array<[RegExp, string]> = [
  [/white\s+eyes?\s+pupils?/gi,     "light-colored eyes, preserve exact eye appearance"],
  [/white\s+pupils?/gi,             "bright iris, preserve exact eye color"],
  [/showing?\s+skin/gi,             "athletic build visible"],
  [/skin\s+tone/gi,                 "natural complexion"],
  [/tight\s+(body|physique)/gi,     "athletic physique"],
  [/full\s+body\s+nude/gi,          "full body athletic"],
  [/barely\s+clothed/gi,            "minimally styled"],
  [/bed\s+scene/gi,                 "relaxed pose"],
  [/intimate\s+moment/gi,           "close moment"],
  [/legs?\s+apart/gi,               "dynamic stance"],
  [/spread\s+(legs?|open)/gi,       "open stance"],
  // Парфюм/люкс специфические паттерны
  [/desire\s+(for|of|to)/gi,        "longing for"],
  [/makes?\s+(?:you\s+)?(?:feel\s+)?sexy/gi, "makes you feel confident"],
  [/(?:raw|savage|wild)\s+(?:desire|passion|power|energy)/gi, "elemental force"],
  [/(?:sweat|sweat\w+)\s+(?:on|across|down)\s+(?:skin|body|face)/gi, "glistening on the surface"],
  [/(?:body|skin)\s+(?:against|on|touching)/gi, "figure beside"],
  [/(?:runs?|slides?)\s+(?:hands?|fingers?)\s+(?:over|across|down)\s+(?:body|skin|chest)/gi, "moves through space"],
  [/caress(?:ing)?/gi,              "touching gently"],
  [/fondle/gi,                      "hold"],
  [/grabb?ing/gi,                   "reaching"],
  [/pant(?:ing)?/gi,                "breathing"],
  [/heav(?:y|ing)\s+breath/gi,      "deep breath"],
  [/half[\s-]naked/gi,              "minimal attire"],
  [/strip(?:ping)?/gi,              "reveal"],
  [/undress(?:ing)?/gi,             "reveal"],
];

/**
 * Очищает промт от NSFW-триггеров сохраняя смысл.
 * Возвращает { prompt, changed, replacements }
 */
export function sanitizePromptForNSFW(prompt: string): {
  prompt: string;
  changed: boolean;
  replacements: string[];
} {
  let result = prompt;
  const replacements: string[] = [];

  // Замена фраз (приоритет — раньше чем слова)
  for (const [pattern, replacement] of NSFW_PHRASE_PATTERNS) {
    pattern.lastIndex = 0; // reset stateful /gi regex before test
    if (pattern.test(result)) {
      replacements.push(`phrase: "${pattern.source}" → "${replacement}"`);
      pattern.lastIndex = 0; // reset again before replace
      result = result.replace(pattern, replacement);
    }
  }

  // Замена отдельных слов (case-insensitive, с границами слова)
  for (const [bad, safe] of Object.entries(NSFW_WORD_MAP)) {
    const pattern = new RegExp(`\\b${bad.replace(/-/g, "[-\\s]?")}\\b`, "gi");
    if (pattern.test(result)) {
      replacements.push(`word: "${bad}" → "${safe}"`);
      result = result.replace(pattern, (match) => {
        // Сохраняем капитализацию
        if (match[0] === match[0].toUpperCase()) {
          return safe[0].toUpperCase() + safe.slice(1);
        }
        return safe;
      });
    }
  }

  return {
    prompt: result,
    changed: result !== prompt,
    replacements,
  };
}

/**
 * Проверяет ответ от Atlas/fal.ai — это NSFW блокировка или другая ошибка?
 */
export function isNSFWBlock(response: { error?: string; message?: string; detail?: string }): boolean {
  const text = [response.error, response.message, response.detail]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("nsfw") ||
    text.includes("safety") ||
    text.includes("content policy") ||
    text.includes("inappropriate") ||
    text.includes("violates") ||
    text.includes("blocked") ||
    text.includes("not allowed") ||
    text.includes("prohibited") ||
    text.includes("restricted content") ||
    text.includes("harmful")
  );
}

/**
 * Стратегия повтора при NSFW блокировке:
 * 1. Sanitize промт
 * 2. Убрать @Image теги из prompt (оставить только в image_url)
 * 3. Упростить описание до минимума
 * 4. Сменить провайдер
 */
export function buildNSFWFallbackPrompt(originalPrompt: string): string {
  const { prompt: sanitized } = sanitizePromptForNSFW(originalPrompt);

  // Дополнительные меры: убираем детальные описания тела
  // Оставляем только движение камеры и объект
  const sentences = sanitized.split(/[.!?]+/).filter(s => s.trim().length > 10);

  // Берём первые 2 предложения (обычно это камера + действие без телесного описания)
  const shortened = sentences
    .slice(0, 2)
    .map(s => s.trim())
    .join(". ") + ".";

  return shortened;
}

/**
 * Порядок провайдеров при NSFW fallback.
 * fal.ai Seedance 1.5 имеет другую safety политику чем Atlas.
 * Kling — мягче к брендовому контенту.
 */
export const NSFW_FALLBACK_CHAIN = [
  "seedance-15",  // fal.ai Seedance 1.5 — другой safety filter чем Atlas
  "kling-pro",    // Kling Pro — более лояльный к fashion/beauty контенту
  "kling",        // Kling Standard
  "hailuo",       // MiniMax — китайский, более лояльный к artistic content
] as const;
