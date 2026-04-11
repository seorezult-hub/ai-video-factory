/**
 * pipeline-guard.ts
 *
 * Не просто "на каком шаге упало" — а "починить ДО того как упало".
 * Каждый guard запускается ДО соответствующего шага и либо:
 * - исправляет проблему (auto-repair)
 * - выбирает другой путь (routing)
 * - выбрасывает понятную ошибку с решением
 */

import { probeFFmpegTransitions } from "./ffmpeg-probe";
import { sanitizePromptForNSFW } from "./nsfw-guard";

// ── Guard 1: LLM Script ──────────────────────────────────────────────────────
// Проблемы: LLM вернул неверный JSON, нет @Image тегов, мало слов, нет таймкодов.
// Решение: auto-repair вместо падения.

interface ScriptScene {
  sceneNumber: number;
  visualPrompt: string;
  description: string;
  cameraMovement: string;
  duration: string;
}

export function guardScript(scenes: ScriptScene[], opts?: { brandImagesCount?: number }): {
  scenes: ScriptScene[];
  repairs: string[];
  warnings: string[];
} {
  const brandImagesCount = opts?.brandImagesCount ?? 6;
  const repairs: string[] = [];
  const warnings: string[] = [];

  const repairedScenes = scenes.map((scene, i) => {
    let vp = scene.visualPrompt ?? "";

    // Repair 1: нет visualPrompt — генерируем минимальный
    if (!vp || vp.trim().length < 20) {
      vp = `@Image1 dynamic branded motion. Scene ${scene.sceneNumber} branded visual. Camera moves elegantly.`;
      repairs.push(`scene ${i + 1}: visualPrompt пустой — заменён базовым`);
    }

    // Repair 2: normalise @Image tags (LLM пишет @image1, @Image 2, etc.)
    const normalized = vp.replace(/@\s*[Ii]mage\s*([1-6])/g, "@Image$1");
    if (normalized !== vp) {
      repairs.push(`scene ${i + 1}: нормализованы @Image теги`);
      vp = normalized;
    }

    // Repair 3: слишком короткий промт (< 50 слов)
    const wordCount = vp.split(/\s+/).length;
    if (wordCount < 50) {
      warnings.push(`scene ${i + 1}: visualPrompt ${wordCount} слов < 50 — может быть слабый результат`);
    }

    // Repair 4: слишком длинный промт (> 150 слов) — обрезаем до 130
    if (wordCount > 150) {
      vp = vp.split(/\s+/).slice(0, 130).join(" ") + ".";
      repairs.push(`scene ${i + 1}: visualPrompt обрезан с ${wordCount} до 130 слов`);
    }

    // Repair 5: нет @Image тегов вообще и нет brandImages — добавляем @Image1
    if (!/@Image[1-6]/.test(vp)) {
      warnings.push(`scene ${i + 1}: нет @Image тегов — Seedance не получит бренд-ассеты`);
    }

    // Repair 6: NSFW sanitize
    const { prompt: sanitized, replacements } = sanitizePromptForNSFW(vp);
    if (replacements.length > 0) {
      repairs.push(`scene ${i + 1}: NSFW sanitize (${replacements.length} замен): ${replacements.slice(0, 2).join("; ")}`);
      vp = sanitized;
    }

    // Repair 7: duration — если нет или некорректна
    let duration = scene.duration;
    const durNum = parseInt(duration);
    if (!duration || isNaN(durNum) || durNum < 3) {
      duration = "5";
      repairs.push(`scene ${i + 1}: duration "${scene.duration}" → "5"`);
    }

    // Repair 8: последняя сцена должна иметь лого (только если @Image4 реально загружен)
    // BUG-037: добавляем @Image4 только если brandImagesCount >= 4
    if (i === scenes.length - 1 && brandImagesCount >= 4 && !/@Image4|logo|brand\s*mark/i.test(vp)) {
      vp = vp.trimEnd() + " @Image4 brand logo held on screen. Final frame.";
      repairs.push(`scene ${i + 1} (last): добавлен @Image4 brand logo`);
    }

    // Repair 9: EXIT DIRECTION — только для длинных роликов (> 5 сцен), не для 15-single
    // Метод Егора Кузьмина: естественный язык, не нужно форсировать EXIT-теги для коротких видео
    const isSingleShot = scenes.length === 1;
    const isLongFormat = scenes.length > 5;
    if (isLongFormat && !isSingleShot && i < scenes.length - 1) {
      const hasExit = /EXIT[S]?\s+(FRAME|RIGHT|LEFT|UP|DOWN|ON|with)/i.test(vp) ||
                      /ENDS\s+ON/i.test(vp);
      if (!hasExit) {
        const cam = (scene.cameraMovement ?? "").toLowerCase();
        let exitDir = "EXITS FRAME RIGHT.";
        if (cam.includes("push-in") || cam.includes("dolly")) exitDir = "ENDS ON subject centered in frame.";
        else if (cam.includes("orbit")) exitDir = "ENDS ON circular composition centered.";
        else if (cam.includes("overhead")) exitDir = "ENDS ON subject fills frame from above.";
        else if (cam.includes("dolly back")) exitDir = "EXITS FRAME as camera pulls back.";
        vp = vp.trimEnd() + ` ${exitDir}`;
        repairs.push(`scene ${i + 1}: добавлен EXIT direction (long format > 5 scenes)`);
      }
    }

    // Repair 10: TONAL CONTINUITY — только для длинных роликов (> 5 сцен), не для 15-single
    // Для коротких видео (1-5 сцен) по методу Егора не добавляем принудительно
    if (isLongFormat && !isSingleShot && i > 0) {
      const hasTonal = /same\s+(warm|cool|golden|amber|soft|cold|natural|blue|white)\s+(light|tone|palette|ambient)/i.test(vp) ||
                       /same\s+lighting/i.test(vp) ||
                       /CONTINUES\s+from/i.test(vp) ||
                       /same\s+(color|colour)/i.test(vp);
      if (!hasTonal) {
        vp = vp.trimEnd() + " Same lighting tone as previous scene.";
        repairs.push(`scene ${i + 1}: добавлена tonal continuity (long format > 5 scenes)`);
      }
    }

    // Repair 11: антислоп — убираем запрещённые слова
    const SLOP_REPLACEMENTS: Record<string, string> = {
      breathtaking: "striking",
      stunning: "sharp",
      captivating: "compelling",
      seamlessly: "smoothly",
      effortlessly: "with ease",
      "cinematic masterpiece": "cinematic",
      amazing: "notable",
      gorgeous: "rich",
      incredible: "precise",
      magnificent: "grand",
      mesmerizing: "hypnotic",
      "luxurious feel": "premium",
    };

    for (const [pattern, replacement] of Object.entries(SLOP_REPLACEMENTS)) {
      const re = new RegExp(pattern, "gi");
      if (re.test(vp)) {
        vp = vp.replace(re, replacement);
        repairs.push(`scene ${scene.sceneNumber}: anti-slop → replaced "${pattern}" with "${replacement}"`);
      }
    }

    return { ...scene, visualPrompt: vp, duration };
  });

  return { scenes: repairedScenes, repairs, warnings };
}

// ── Guard 2: @Image Payload ───────────────────────────────────────────────────
// Проблемы: brandImages содержит пустые строки, не-URL, дубликаты.
// Решение: очистить и проверить ПЕРЕД отправкой в Atlas.

export function guardBrandImages(brandImages: string[]): {
  images: string[];
  repairs: string[];
  warnings: string[];
} {
  const repairs: string[] = [];
  const warnings: string[] = [];

  // Фильтруем только валидные URL
  const cleaned = brandImages.map((url, i) => {
    if (!url || typeof url !== "string") {
      repairs.push(`@Image${i + 1}: пустой → исключён`);
      return null;
    }
    try {
      const u = new URL(url);
      if (!["https:", "http:"].includes(u.protocol)) {
        repairs.push(`@Image${i + 1}: не-URL "${url.slice(0, 50)}" → исключён`);
        return null;
      }
      return url;
    } catch {
      repairs.push(`@Image${i + 1}: невалидный URL → исключён`);
      return null;
    }
  }).filter((u): u is string => u !== null);

  if (cleaned.length === 0) {
    warnings.push("Нет валидных brandImages — Seedance будет работать без бренд-ассетов");
  }

  if (cleaned.length < 4) {
    warnings.push(`Только ${cleaned.length}/6 ассетов — @Image4 (лого) и @Image5 (продукт) могут отсутствовать`);
  }

  return { images: cleaned, repairs, warnings };
}

// ── Guard 3: Atlas Payload ────────────────────────────────────────────────────
// Проблемы: нет imageUrl для сцены, 15 сек на fal.ai, неверный model string.
// Решение: auto-fix перед отправкой.

export function guardAtlasPayload(payload: {
  prompt: string;
  image_url: string | undefined;
  duration: number;
  useAtlas: boolean;
  is15single: boolean;
  brandImages: string[];
}): {
  payload: typeof payload & { image_url: string };
  repairs: string[];
  errors: string[];
} {
  const repairs: string[] = [];
  const errors: string[] = [];

  let { image_url, duration, useAtlas, is15single } = payload;

  // Fix 1: нет image_url — используем первый brandImage
  if (!image_url || image_url.trim() === "") {
    const fallback = payload.brandImages[0];
    if (fallback) {
      image_url = fallback;
      repairs.push(`image_url пустой → используем brandImages[0]`);
    } else {
      errors.push("КРИТИЧНО: нет image_url и нет brandImages — Atlas вернёт ошибку");
    }
  }

  // Fix 2: 15 сек на fal.ai невозможно
  if (is15single && !useAtlas) {
    duration = 10;
    repairs.push(`15-single на fal.ai невозможен → duration снижен до 10 сек`);
  }

  // Fix 3: duration вне диапазона Atlas (5, 8, 10, 15)
  if (useAtlas) {
    const allowed = [5, 8, 10, 15];
    if (!allowed.includes(duration)) {
      const nearest = allowed.reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a);
      repairs.push(`duration ${duration} → ${nearest} (Atlas поддерживает только ${allowed.join(", ")} сек)`);
      duration = nearest;
    }
  }

  return {
    payload: { ...payload, image_url: image_url ?? "", duration },
    repairs,
    errors,
  };
}

// ── Guard 4: FFmpeg Assembly ──────────────────────────────────────────────────
// Проблемы: нет клипов, FFmpeg не установлен, transitions недоступны, vibrance упадёт.
// Решение: проверить заранее и дать понятную ошибку.

export async function guardFFmpegAssembly(clipUrls: string[]): Promise<{
  ready: boolean;
  ffmpegVersion: string;
  availableTransitions: string[];
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (clipUrls.length === 0) {
    errors.push("Нет клипов для сборки");
    return { ready: false, ffmpegVersion: "unknown", availableTransitions: [], errors, warnings };
  }

  const { verified, failed, ffmpegVersion } = await probeFFmpegTransitions();

  if (ffmpegVersion === "not-installed") {
    errors.push("FFmpeg не установлен — сборка невозможна");
    return { ready: false, ffmpegVersion, availableTransitions: [], errors, warnings };
  }

  if (failed.length > 0) {
    warnings.push(`FFmpeg ${ffmpegVersion}: недоступно ${failed.length} transitions (${failed.slice(0, 3).join(", ")}...) — используем fallback dissolve`);
  }

  if (clipUrls.length > 20) {
    warnings.push(`${clipUrls.length} клипов — сборка может занять > 5 минут`);
  }

  return {
    ready: errors.length === 0,
    ffmpegVersion,
    availableTransitions: verified,
    errors,
    warnings,
  };
}

// ── Guard 5: Model Chain Health ───────────────────────────────────────────────
// Проверяет доступность всех моделей в цепочке ПЕРЕД генерацией.
// Запускать один раз при старте или по запросу /api/health.

export async function guardModelChain(keys: {
  atlasKey?: string;
  falKey?: string;
  geminiKey?: string;
  groqKey?: string;
}): Promise<{
  atlas: boolean;
  fal: boolean;
  gemini: boolean;
  groq: boolean;
  primaryProvider: "atlas" | "fal" | "none";
  warnings: string[];
}> {
  const warnings: string[] = [];

  const [atlasOk, falOk] = await Promise.all([
    // Atlas ping
    keys.atlasKey
      ? fetch("https://api.atlascloud.ai/api/v1/health", {
          headers: { Authorization: `Bearer ${keys.atlasKey}` },
          signal: AbortSignal.timeout(5_000),
        }).then(r => r.ok).catch(() => false)
      : Promise.resolve(false),

    // fal.ai ping (проверяем что ключ валиден через /queue/status эндпоинт)
    keys.falKey
      ? fetch("https://queue.fal.run/fal-ai/status", {
          headers: { Authorization: `Key ${keys.falKey}` },
          signal: AbortSignal.timeout(5_000),
        }).then(r => r.status !== 401).catch(() => false)
      : Promise.resolve(false),
  ]);

  if (!atlasOk && !falOk) {
    warnings.push("КРИТИЧНО: ни Atlas ни fal.ai недоступны — генерация невозможна");
  } else if (!atlasOk) {
    warnings.push("Atlas недоступен — будет использован fal.ai (Seedance 1.5, качество ниже)");
  }

  const geminiOk = !!keys.geminiKey && keys.geminiKey.length > 10;
  const groqOk = !!keys.groqKey && keys.groqKey.length > 10;

  if (!geminiOk) warnings.push("GEMINI_API_KEY не найден — quality gate отключён");
  if (!groqOk) warnings.push("GROQ_API_KEY не найден — script generation деградирует до OpenRouter");

  return {
    atlas: atlasOk,
    fal: falOk,
    gemini: geminiOk,
    groq: groqOk,
    primaryProvider: atlasOk ? "atlas" : falOk ? "fal" : "none",
    warnings,
  };
}
