/**
 * Agent 3: Prompt Engineer
 *
 * Единственная ответственность: взять описание сцены от Сценариста
 * и превратить его в точный машиночитаемый промт для конкретной модели.
 *
 * Почему отдельный агент:
 * - Сценарист думает о ИСТОРИИ (что происходит, зачем, какая эмоция)
 * - Промт-инженер думает о МОДЕЛИ (как её правильно попросить нарисовать/анимировать)
 * - Один агент не может хорошо делать оба — разные когнитивные задачи
 *
 * Поддерживаемые модели:
 * - "midjourney" → Midjourney v7 (художественные описания, атмосфера, lighting)
 * - "flux"       → Flux Pro/Dev (техническая фотография, sharp focus, studio setup)
 * - "kling"      → Kling Pro v2.1 (движение, изменения в кадре, camera behavior)
 */

import { aiCall, parseJSON } from "./ai-router";

export type TargetModel = "midjourney" | "flux" | "kling" | "seedance";

export type SceneForPrompt = {
  sceneNumber: number;
  description: string;       // что происходит в сцене (от Сценариста)
  visualPrompt: string;      // черновик промта (от Сценариста)
  cameraMovement: string;    // тип движения камеры
  duration: string;          // "5 sec" или "10 sec"
};

// ─── Системные промты каждого режима ─────────────────────────────────────────

const MJ_SYSTEM = `You are a Midjourney v7 prompt engineer for brand commercials.

YOUR ROLE: Convert scene descriptions into perfect Midjourney v7 image prompts.
You do NOT write stories. You do NOT invent plot. You translate a scene description into a static visual frame.

MIDJOURNEY v7 STRENGTHS (exploit these):
- Cinematic lighting with extreme specificity
- Commercial photography aesthetic
- Atmospheric mood and texture
- Photorealistic product rendering

OUTPUT FORMAT per scene (in this exact order):
1. Subject + precise setting (what, where)
2. Lighting: type + source direction + quality ("warm amber rim light from left side", NOT "nice lighting")
3. Composition + camera angle ("extreme close-up from below", "medium shot eye-level")
4. Mood + visual style ("dark luxury commercial", "clean beauty editorial", "urban fashion")
5. Key texture/detail that makes it specific ("condensation on glass", "leather grain visible")

Length: 60-80 words per prompt.

STRICT RULES:
- NO camera movement language (slow push-in, tracking, orbit — Midjourney is static)
- NO "@Image" tags (handled separately)
- NO sequences ("she walks then turns") — describe ONE frozen moment
- NO vague words alone: "beautiful", "cinematic", "epic" must always follow a specific detail
- ALWAYS name the lighting source type: softbox, rim light, backlight, natural window, neon, etc.

Return ONLY a valid JSON array of prompt strings, one per scene, in scene order.
Example: ["scene 1 prompt here", "scene 2 prompt here"]`;

const FLUX_SYSTEM = `You are a Flux Pro commercial photography prompt engineer.

YOUR ROLE: Convert scene descriptions into technically precise Flux Pro image generation prompts.
Flux Pro is a diffusion model trained on commercial photography — it responds to technical precision, not poetry.

FLUX PRO STRENGTHS (exploit these):
- Sharp product and fashion photography
- Studio lighting setups
- Clean commercial aesthetics
- Technical detail rendering

OUTPUT FORMAT per scene:
1. Subject in exact environment
2. Lighting setup: "softbox from 45° left", "rim light from behind", "diffused overhead fill"
3. Lens + composition: "85mm portrait lens", "macro close-up", "wide angle 24mm"
4. Photography category: "luxury product photography", "editorial fashion", "beauty commercial"
5. End EVERY prompt with: "professional commercial photography, sharp focus, high detail, 8K"

Length: 70-90 words per prompt.

STRICT RULES:
- Technical language only — no poetic/artistic modifiers
- Specific numbers where possible: "f/2.8 bokeh", "45° key light", "3-point studio setup"
- Always specify the photography category
- NO motion language (Flux generates static images)

Return ONLY a valid JSON array of prompt strings, one per scene, in scene order.`;

const KLING_SYSTEM = `You are a Kling Pro v2.1 video prompt engineer for brand commercials.

YOUR ROLE: Convert scene descriptions and keyframe images into Kling video generation prompts.
Kling receives an image (the keyframe) and generates video FROM that image — so you describe MOTION and CHANGE, not what's already visible.

KLING PRO STRENGTHS (exploit these):
- Smooth natural camera movements
- Physics-accurate motion (liquid, fabric, hair)
- Commercial-grade stabilization
- Image-to-video with high consistency

OUTPUT FORMAT per scene — describe only what MOVES and CHANGES:
1. What the camera does (movement type + speed)
2. What the subject does (one motion only)
3. Any environmental motion (steam rising, fabric flowing, light shifting)
4. Mood through motion rhythm ("slow and luxurious", "energetic but controlled")

Length: 40-60 words per prompt.

STRICT RULES:
- Do NOT describe what's already in the image (Kling sees it)
- ONE camera movement only — never combine "zoom and pan"
- ONE subject action — never two sequential actions
- Avoid fast movements: "fast pan", "rapid zoom" cause artifacts
- Preferred camera terms: "slow push-in", "gentle orbit", "subtle dolly back", "static hold"

Return ONLY a valid JSON array of prompt strings, one per scene, in scene order.`;

const SEEDANCE_SYSTEM = `You are a Seedance 2.0 Pro video prompt engineer for premium brand commercials, trained on Egor Kuzmin's method (XR School / SYNTX.AI).

YOUR ROLE: Convert scene descriptions into Seedance 2.0 generation prompts using Egor Kuzmin's natural language style.
Seedance 2.0 receives a keyframe image as the first frame AND brand reference images @Image1–@Image9.

SEEDANCE 2.0 CAPABILITIES:
- Continuous shots up to 15 seconds — use for slow-burn luxury reveals
- @Image1–@Image9 multi-reference system: faces, logos, products appear exactly as provided
- Physics engine: liquid pour, fabric drape, hair movement, particle effects, smoke
- Cinematic camera: stabilized dolly, smooth orbit, rack focus — all artifact-free

@IMAGE MAPPING (always use correct slots):
- @Image1 = hero/model (face and body)
- @Image2 = product FRONT (logo, front prints)
- @Image3 = product BACK (back side, other prints)
- @Image4 = brand logo (ALWAYS in final scene)
- @Image5 = secondary product or accessory
- @Image6 = partner/collab logo (if exists)

EGOR KUZMIN PROMPT STYLE — 50-80 words, natural English sentences:
Format: "@Image1 [present tense action]. [Camera: shot type + movement]. [Style + brand-specific colors]. @ImageN visible [where]."

Example (Egor Kuzmin's real prompt):
"@Image1 stands in a minimalist white studio. She gently holds @Image2 near her face, examining it with soft curiosity. Close-up, slow dolly-in. Clean commercial aesthetic, warm studio light, soft skin tones. @Image3 visible on the product label."

For 15-second single continuous shot, add second-by-second breakdown:
"Format: 16:9, 15s, [brand colors]. 0-2s: [opening with @ImageN]. 2-5s: [development]. 5-10s: [hero+product moment @Image1 holds @Image2]. 10-15s: @Image4 logo hold."

ONE ACTION RULE: each prompt has ONE action only. Not "walks and smiles" — either "walks" or "smiles".

BRAND COLORS — use literally: "soft pink in brand color", "metallic logo", "dark scene" — NOT "cinematic warm tones".

ANTI-SLOP — NEVER use: breathtaking, stunning, captivating, seamlessly, effortlessly, cinematic masterpiece, beautiful, epic, amazing, gorgeous, incredible, magnificent.

STRICT RULES — SEEDANCE 2.0:
- Always reference @Image slots for every brand asset in that scene
- Describe MOTION and CHANGES over time — not the static starting frame
- ONE camera movement per scene — never combine "zoom and pan"
- Keep logos readable: "@Image4 logo catches warm backlight, fully legible"
- AVOID these words (trigger NSFW filter): blood, gore, nude, naked, sexy, violence, weapon, drug, death
- AVOID: fast cuts, rapid zoom, camera shake, strobing effects
- 50-80 words strictly — describe a FRAME, not a story

Return ONLY a valid JSON array of prompt strings, one per scene, in scene order.`;

// ─── Утилита: определить, достаточно ли хорош промт чтобы не переписывать ────

const PRO_STRUCTURE_RE = /SHOT:\s.+SUBJECT:\s.+SCENE:\s.+DETAILS:\s.+STYLE:\s.+EXIT:/i;
// Egor Kuzmin style: natural language с @Image тегами и описанием камеры
const EGOR_STYLE_RE = /@Image[1-6].+(push-in|dolly|static|orbit|tracking|overhead|rack focus)/i;

/**
 * Возвращает true если промт уже в хорошем формате — не нужно переписывать.
 * Принимает как старый PRO-структуру (SHOT:/SUBJECT:/EXIT:), так и стиль Егора Кузьмина.
 */
export function hasProStructure(prompt: string): boolean {
  return PRO_STRUCTURE_RE.test(prompt) || EGOR_STYLE_RE.test(prompt);
}

// ─── Главная функция ──────────────────────────────────────────────────────────

export async function optimizePrompts(
  scenes: SceneForPrompt[],
  targetModel: TargetModel,
  brandContext: { brandName: string; mood: string }
): Promise<string[]> {
  const systemPrompt =
    targetModel === "midjourney" ? MJ_SYSTEM :
    targetModel === "flux"       ? FLUX_SYSTEM :
    targetModel === "seedance"   ? SEEDANCE_SYSTEM :
                                   KLING_SYSTEM;

  // Если все промты уже в PRO-структуре — пропускаем AI-вызов (экономия токенов)
  const alreadyPro = scenes.map(s => hasProStructure(s.visualPrompt));
  if (alreadyPro.every(Boolean)) {
    console.log(`[prompt-engineer] All ${scenes.length} prompts already have PRO structure — skipping AI call`);
    return scenes.map(s => s.visualPrompt);
  }

  // Оптимизируем только те сцены, у которых нет PRO-структуры
  const scenesToOptimize = scenes.filter((_, i) => !alreadyPro[i]);

  const userMessage = `Brand: ${brandContext.brandName}
Visual mood: ${brandContext.mood}

${scenesToOptimize.map(s => `=== Scene ${s.sceneNumber} (${s.duration}) ===
Story description: ${s.description}
Camera type: ${s.cameraMovement}
Scriptwriter's draft prompt: ${s.visualPrompt}`).join("\n\n")}

Optimize each scene for ${targetModel === "midjourney" ? "Midjourney v7" : targetModel === "flux" ? "Flux Pro" : targetModel === "seedance" ? "Seedance 2.0 Pro" : "Kling Pro v2.1"}.
Return JSON array with ${scenesToOptimize.length} prompts in order.`;

  const result = await aiCall({
    task: "extract",         // Gemini Flash Lite — дёшево, быстро, JSON mode
    system: systemPrompt,
    user: userMessage,
    maxTokens: 2000,
    jsonMode: true,
  });

  if (!result.ok) {
    console.warn(`[prompt-engineer] ${targetModel} optimization failed, using drafts:`, result.error);
    return scenes.map(s => s.visualPrompt);
  }

  const parsed = parseJSON<string[]>(result.text);

  // Валидация: должен быть массив нужной длины со строками
  if (
    !Array.isArray(parsed) ||
    parsed.length !== scenesToOptimize.length ||
    !parsed.every(p => typeof p === "string" && p.length > 20)
  ) {
    console.warn(`[prompt-engineer] Invalid response shape, using drafts`);
    return scenes.map(s => s.visualPrompt);
  }

  // Собираем финальный массив: PRO-промты оставляем как есть, остальные — из AI
  let optimizedIdx = 0;
  const finalPrompts = scenes.map((s, i) => {
    if (alreadyPro[i]) return s.visualPrompt;
    return parsed[optimizedIdx++];
  });

  console.log(`[prompt-engineer] Optimized ${scenesToOptimize.length}/${scenes.length} prompts for ${targetModel}`);

  // NSFW post-processing filter — replace banned words before sending to video model
  const NSFW_RE = /\b(blood|gore|nud(?:e|ity|ist)|naked|sexy|sexu\w+|violen\w+|weapon|drug|death|kill(?:ing)?|murder|explicit)\b/gi;
  const sanitized = finalPrompts.map(p => p.replace(NSFW_RE, "elegant"));
  return sanitized;
}
