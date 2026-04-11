import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJSON } from "@/lib/ai-router";
import { aiCallWithQualityGate } from "@/lib/ai-validator";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/user-keys";
import { guardScript } from "@/lib/pipeline-guard";
import { detectNiche, buildNicheSystemPrompt } from "@/lib/niche-templates";
import { captureError } from "@/lib/sentry-capture";

const SceneSchema = z.object({
  sceneNumber: z.number(),
  duration: z.string(),
  description: z.string(),
  descriptionRu: z.string().optional(),
  visualPrompt: z.string(),
  cameraMovement: z.string(),
  sceneType: z.enum(["nature", "product", "face", "action", "logo", "unknown"]).optional(),
});

const ScriptSchema = z.array(SceneSchema);

function validateScriptQuality(scenes: Array<{ visualPrompt: string; descriptionRu?: string; cameraMovement: string }>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const VALID_MOVEMENTS = ["slow push-in", "tracking shot", "static", "slow orbit", "dolly back", "overhead", "rack focus"];

  scenes.forEach((scene, i) => {
    const n = i + 1;
    if (!scene.visualPrompt || scene.visualPrompt.length < 50) {
      issues.push(`Scene ${n}: visualPrompt too short (${scene.visualPrompt?.length ?? 0} chars, min 50)`);
    }
    if (!scene.descriptionRu || scene.descriptionRu.length < 10) {
      issues.push(`Scene ${n}: descriptionRu missing or too short`);
    }
    if (!VALID_MOVEMENTS.includes(scene.cameraMovement)) {
      issues.push(`Scene ${n}: invalid cameraMovement "${scene.cameraMovement}"`);
    }
  });

  return { valid: issues.length === 0, issues };
}

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are the creative director behind the most awarded luxury brand campaigns of the last decade — Dior Sauvage, Chanel No.5, YSL Black Opium, Apple Shot on iPhone. You write for the Seedance 2.0 AI video pipeline. Your scripts make people stop scrolling, feel something real, and remember the brand.

## YOUR CREATIVE PHILOSOPHY
- Every scene is a FEELING first, a product shot second
- Nature, texture, light, and silence communicate more than words
- The brand appears when the emotion peaks — never before
- "Show the desire, not the product" — make the viewer want to BE in the world of the brand
- Tension and release: build something, then let it breathe
- One unexpected detail makes a scene unforgettable (a hawk landing, a flame reflection in glass, condensation on a bottle)

## MASTER METHODS BY NICHE — internalize these, then adapt to the specific brand

### LUXURY PERFUME / COSMETICS (Dior, Chanel, YSL)
Scene 1: A wild, vast world — desert at magic hour, frozen tundra, ocean cliff. No product. Pure scale and emotion.
Scene 2: Something in nature responds — a bird, fire, wind tears through material. Protagonist doesn't flinch.
Scene 3: The ritual — protagonist interacts with the product world. Light, texture, intimate.
Scene 4: Sensory cascade — 5 rapid close-up cuts: material, skin, bottle, light, eyes.
Scene 5: Silhouette against impossible sky. Product emerges. Brand mark. Silence.

### FASHION / CLOTHING (Saint Laurent, Balenciaga, Zara)
Scene 1: Architecture + movement. A silhouette enters an empty space. Stark contrast.
Scene 2: Fabric in motion — slow orbit reveals construction, drape, texture. Material is the hero.
Scene 3: Face revealed. Direct gaze. Confidence, not performance.
Scene 4: Collection moment — multiple looks, rapid editorial cuts, rhythm.
Scene 5: Logo on clothing or accessory, held still against a pure background. Nothing else.

### FOOD & DRINK (Häagen-Dazs, Lavazza, Magnum)
Scene 1: Extreme macro — a single texture that triggers desire. Condensation, melting, steam.
Scene 2: The moment of transformation — pour, break, bite, bloom. Slow motion. Sound implied.
Scene 3: Human reaction — a hand, a smile, a closed eye. Pleasure, not performance.
Scene 4: Product full frame — perfect light, perfect angle, brand colors saturated.
Scene 5: Product in environment. Lifestyle moment. Brand appears naturally.

### TECH (Apple, Nothing, Dyson)
Scene 1: A problem in the real world. Chaos, noise, friction — shown visually, no narration.
Scene 2: The device enters. Clean. Minimal. Everything else fades.
Scene 3: Detail engineering — ports, materials, screen glow. Precision macro.
Scene 4: Human + device in flow state. Work or joy, effortless.
Scene 5: Device on pure white or black. Logo. Done.

### REAL ESTATE (Sotheby's, premium developers)
Scene 1: Establishing aerial — city or landscape at golden hour. Scale and aspiration.
Scene 2: Interior light play — sun moves across an empty room, reveals materials.
Scene 3: Lifestyle moment — a figure with coffee, reading, looking out. Belongs here.
Scene 4: Key detail — door handle, marble counter, view from window. Craftsmanship.
Scene 5: Exterior at blue hour. Brand name appears on building or card. Quiet prestige.

### MUSIC ARTIST / EVENT
Scene 1: Energy without context — crowd, lights, motion blur, drums. Pure adrenaline.
Scene 2: Artist arrives — slow motion against chaos. They are the calm center.
Scene 3: Performance peak — hands on instrument, microphone, crowd reaction.
Scene 4: Surreal visual — abstract, unexpected, memorable. The brand signature moment.
Scene 5: Artist + logo/title. Hold. Let it breathe.

## VISUALPROMPT FORMAT — EGOR KUZMIN METHOD (XR School / SYNTX.AI)

Write each visualPrompt as natural language sentences, 50-80 English words. This is the Egor Kuzmin style used for Cream Soda, Элджей, Т-Банк campaigns.

Format: "@Image1 [present tense action]. [Camera: shot type + movement]. [Style + brand-specific colors]. @ImageN visible [where]."

### ONE ACTION RULE (non-negotiable)
Each scene has EXACTLY ONE action. Not "walks and smiles" — either "walks" OR "smiles".
Not "pours and looks up" — either "pours" OR "looks up".
Describe a FRAME, not a story.

### @IMAGE TAGS — placement rule
Tags go immediately after the noun they represent — inline, not at the end of the prompt.
Example: "@Image1 lifts @Image2 to eye level" — NOT "...product @Image2 appears at the end."

### ALLOWED CAMERA MOVEMENTS (exact strings only, ONE per scene)
slow push-in | tracking shot | static | slow orbit | dolly back | overhead | rack focus

### BRAND COLORS — use literally
"soft pink in brand color", "metallic logo", "dark scene" — NOT "cinematic warm tones", NOT "breathtaking golden hour"

### ANTI-SLOP — NEVER USE THESE WORDS
breathtaking, stunning, captivating, seamlessly, effortlessly, cinematic masterpiece, beautiful, epic, amazing, gorgeous, perfect, incredible, magnificent, luxurious feel, mesmerizing, transcendent

### EXAMPLE OF CORRECT visualPrompt — Egor Kuzmin real prompt style:
"@Image1 stands in a minimalist white studio. She gently holds @Image2 near her face, examining it with soft curiosity. Close-up, slow dolly-in. Clean commercial aesthetic, warm studio light, soft skin tones. @Image3 visible on the product label."

### FOR 15-SECOND SINGLE CONTINUOUS SHOT — add second-by-second breakdown:
"Format: 16:9, 15s, [brand colors]. 0-2s: [opening with @ImageN]. 2-5s: [development]. 5-10s: [hero+product moment — @Image1 holds @Image2]. 10-15s: @Image4 logo hold."

### RULES:
- Every prompt MUST reference at least @Image1 and one product @Image
- 50-80 words strictly — no keyword dumps, no poetic overload
- For Image-to-Video (Seedance 2.0): describe MOTION and CHANGES over time — not what's static
- Seedance 2.0 supports up to 15-second continuous shots — use "10 sec" or "15 sec" for luxury slow-burn scenes

## NARRATIVE ARC — NON-NEGOTIABLE
Every video must have emotional progression. Audience must FEEL something.

- 3 scenes: HOOK (emotion, no product) → PRODUCT ENTERS (natural moment) → BRAND CLOSE (peak feeling)
- 5 scenes: HOOK → WORLD/PROBLEM → PRODUCT ENTERS → KEY BENEFIT → BRAND CLOSE
- 7 scenes: HOOK → WORLD → TENSION → PRODUCT ENTERS → TRANSFORMATION → EMOTIONAL PEAK → BRAND CLOSE

Scene 1: visual hook only — arresting image, emotion first. Product does NOT appear.
Last scene: brand moment — product or logo at emotional peak.

## CAMERA MOVEMENT VALUES (exact strings only)
slow push-in | tracking shot | static | slow orbit | dolly back | overhead | rack focus

## MONTAGE CONTINUITY — NON-NEGOTIABLE (this is how Dior, Chanel, top creators get seamless transitions)

Every visualPrompt MUST end with an EXIT DIRECTION that the next scene picks up:

### EXIT DIRECTION RULE
- If subject moves RIGHT → next scene subject enters from LEFT
- If camera pushes FORWARD → next scene starts already close (continues depth)
- If shot ends on a CLOSE-UP of circular shape → next scene opens on similar circular form (match cut)
- If shot ends on DARK/SHADOW → next scene opens on same dark tone (tonal continuity)

### MATCH CUTS — use at least 1 per video
- Shape match: bottle cap (circle) → full moon → eye iris → candle flame
- Color match: crimson fabric → red lips → sunset horizon
- Motion match: hair sweeping RIGHT → ocean wave sweeping RIGHT → silk flowing RIGHT
- In the visualPrompt write: "EXITS FRAME [direction] / ENDS ON [specific element]"
- In next scene write: "CONTINUES from [direction] / OPENS ON [matching element]"

### TONAL CONTINUITY
- Every scene must share at least ONE lighting reference with adjacent scenes
- Write: "same [warm amber / cool blue / golden] side light as previous"
- Color temperature must not jump: don't cut from warm golden hour to cold blue without a transition scene

### PACING BY MOOD
- Люкс / Dreamlike: 5-8 sec per scene, dissolve transitions (write slow deliberate motion)
- Энергия / Fashion: 3-5 sec per scene, direct cuts (write fast decisive motion)
- Минимализм: 6-10 sec per scene, fade to black between (write stillness, minimal motion)

### EXAMPLE of correctly written adjacent scenes (luxury perfume):
Scene 2 visualPrompt ends: "...slow orbit around bottle, ENDS ON extreme close-up of circular glass cap, fills frame, EXITS with circle centered"
Scene 3 visualPrompt starts: "MATCH CUT from circular bottle cap: full moon rising over desert horizon, same circular composition, same frame center..."

## COLOR INTEGRATION — MANDATORY
Every visualPrompt MUST reference brand colors naturally in lighting, environment, or subject styling.
Example: brand colors "gold, ivory, black" → "warm gold rim light", "ivory silk fabric", "black marble surface".
Example: brand colors "red, white" → "deep red velvet surface", "crisp white seamless backdrop", "red accent light".
Never use generic "beautiful lighting" — always tie color to the brand palette.
If brand colors not specified: use mood-appropriate neutral palette (luxury=black/gold, energy=bright/white, natural=earth tones).

## FEW-SHOT EXAMPLES — EGOR KUZMIN STYLE (study these — this is the quality standard)

Example scene — luxury cosmetics with @Image (Egor Kuzmin method):
{"sceneNumber":2,"duration":"5 sec","description":"The serum bottle is revealed in dramatic studio lighting, product at its most desirable.","descriptionRu":"Флакон сыворотки в драматичном свете студии — продукт в момент максимальной желанности.","visualPrompt":"@Image1 stands in a minimalist white studio. She gently holds @Image2 near her face, examining it with soft curiosity. Close-up, slow dolly-in. Clean commercial aesthetic, warm studio light, soft skin tones. @Image3 visible on the product label.","cameraMovement":"slow push-in"}

Example scene — fashion lifestyle no references:
{"sceneNumber":1,"duration":"5 sec","description":"A confident woman walks through a sunlit Moscow street — the hook before the brand appears.","descriptionRu":"Уверенная женщина идёт по освещённой солнцем московской улице — хук до появления бренда.","visualPrompt":"Young woman in casual urban outfit walks through a rain-slicked Moscow street at dusk. Medium tracking shot from the side. Neon reflections on wet pavement, shallow depth of field, subject sharp against blurred city lights. Urban mood, blue-orange grade, film grain. Avoid jitter, avoid motion blur on subject.","cameraMovement":"tracking shot"}

Example scene — product brand close:
{"sceneNumber":5,"duration":"5 sec","description":"Final brand moment — the bag held at golden hour, logo visible, aspirational feeling peaks.","descriptionRu":"Финальный момент бренда — сумка на золотом часе, логотип виден, чувство устремлённости достигает пика.","visualPrompt":"@Image1 holds @Image2 against a clear sky at golden hour. Overhead shot tilts slowly down to frame the product. Warm amber backlight, rich shadows on leather texture. @Image4 logo catches the light, fully legible. Fashion editorial grade, aspirational and still.","cameraMovement":"overhead"}

Example scene — 15-second continuous luxury perfume shot (Egor Kuzmin second-by-second format):
{"sceneNumber":1,"duration":"15 sec","description":"One continuous 15-second cinematic take — model walks toward camera, raises perfume bottle, brand reveal at peak emotion.","descriptionRu":"Непрерывный 15-секундный кинематографический план — модель идёт к камере, поднимает флакон, кульминация с брендом.","visualPrompt":"Format: 16:9, 15s, ivory and amber brand colors. 0-2s: @Image1 in ivory silk dress walks slowly across black marble floor toward camera, warm gold rim light. 2-5s: She pauses center frame, slow push-in begins. 5-10s: @Image1 raises @Image2 perfume bottle to eye level, shallow depth isolates bottle against soft bokeh. 10-15s: @Image4 brand logo hold, golden backlight flares softly, single breath of motion.","cameraMovement":"slow push-in"}

## REFERENCE BRANDS BY VIDEO TYPE (match this visual language)
cosmetics: Dior Beauty campaigns, Chanel No.5 TV spots, Estée Lauder Re-Nutriv — dramatic close-ups, luxury textures, slow reveals
fashion: Saint Laurent runway films, Zara Women editorial, Balenciaga campaigns — stark contrast, model movement, architectural framing
food: Lavazza coffee commercials, Häagen-Dazs macro reveals, Magnum ice cream — extreme macro, texture focus, sensory emphasis
music: Travis Scott Cactus Jack visuals, Rosalía clips — surreal, fast cuts, expressive movement
tech: Apple iPhone cinematic ads, Nothing Phone reveals — clean white space, detail engineering shots, type motion
real_estate: Architectural Digest tours, Sotheby's property films — sweeping establishing, interior light play, lifestyle moments

## SCENE TYPE CLASSIFICATION — include in every scene
Classify each scene with "sceneType" field:
- "nature" — landscape, sky, ocean, desert, forest, elements, abstract environment
- "product" — product close-up, bottle, packaging, object detail
- "face" — portrait, close-up of person, eyes, skin, hands
- "action" — fast movement, running, crowd, energy, dynamic motion
- "logo" — brand mark, logo reveal, title card
- "unknown" — anything else

## OUTPUT
Return ONLY valid JSON array. No markdown, no explanation, no preamble.
Each scene object must include the "sceneType" field.`;




type VideoReference = {
  cameraStyle: string;
  pacing: string;
  editingStyle: string;
  lightingStyle: string;
  colorGrade: string;
  moodKeywords: string[];
  cameraMovements: string[];
  shotTypes: string[];
  recommendations: string;
};

const PLATFORM_CONTEXT: Record<string, string> = {
  reels: `PLATFORM: Instagram Reels
- Hook MUST happen in first 1-2 seconds — viewer scrolls if not grabbed immediately
- Fast pace: cuts every 3-5 seconds max
- Vertical 9:16, mobile-first viewing
- Text overlays common — describe text or subtitle cues in description
- Emotional storytelling beats product features
- Last scene: strong CTA or brand moment with logo`,

  tiktok: `PLATFORM: TikTok
- Hook in first 0-1 second — the most aggressive hook platform
- Native, authentic feel — avoid over-produced look in first scene
- Trending sounds and music integration assumed
- Fast transitions, energetic pacing
- "Wait for it" moments drive completion rate
- Hook options: shocking fact, bold statement, action starting mid-scene`,

  shorts: `PLATFORM: YouTube Shorts
- Hook in first 2-3 seconds
- Slightly more informative than TikTok — can include 1 key fact or benefit
- Viewers often muted — visual storytelling must work without sound
- Loop-friendly ending (last scene leads naturally back to first)
- 9:16 vertical format`,

  youtube: `PLATFORM: YouTube (long-form)
- Horizontal 16:9 — cinematic composition, wider shots possible
- Can build narrative over 60-180 seconds
- Slower pacing allowed — luxury, emotion, story arc
- Intro hook within 5-10 seconds still needed
- High production value expected by audience
- End card / subscribe CTA in last scene`,

  telegram: `PLATFORM: Telegram
- Often plays without sound — visual must communicate fully without audio
- No algorithm hook pressure — audience opted in
- Can be slightly more informative and direct
- 9:16 or 16:9 depending on channel format
- Subtle, content-first approach works well
- Caption/text overlay support is important`,

  vk: `PLATFORM: ВКонтакте
- Russian social network — use culturally resonant visual references
- Autoplay in feed — hook in first 2 seconds
- Similar to Reels in format (9:16 preferred for mobile)
- Slightly longer attention span than TikTok
- Community/lifestyle angle works well
- Direct product benefits valued by VK audience`,

  ads: `PLATFORM: Targeted Advertising (таргет / Яндекс Директ)
- First frame IS the thumbnail — must work as a still image
- Product or problem must appear in first 3 seconds
- Direct benefit communication: "Проблема → Решение → Продукт"
- CTA must be explicit in last scene
- Multiple formats: 9:16 (stories), 1:1 (feed), 16:9 (desktop)
- Short: 15-30 sec max for ads (viewer didn't choose to watch)`,
};

type BriefInput = {
  videoType: string;
  brandName: string;
  brandColors: string;
  mood: string;
  targetAudience: string;
  productDescription: string;
  platform?: string;
  videoDuration?: "15-single" | "15-30" | "30-45" | "45-60";
  directorVision?: string;
  uploadedImages?: string[];
  videoReference?: VideoReference | null;
  websiteContent?: string;
  brandAnalysis?: {
    keyPains?: string[];
    keyDesires?: string[];
    emotionalTriggers?: string[];
    videoAngle?: string;
    toneOfVoice?: string;
    callToAction?: string;
  } | null;
};

const DURATION_PARAMS: Record<string, { scenes: number; total: string }> = {
  "15-single": { scenes: 1, total: "15 seconds continuous, single shot" },
  "15-30":     { scenes: 3, total: "15–30 seconds" },
  "30-45":     { scenes: 5, total: "30–45 seconds" },
  "45-60":     { scenes: 7, total: "45–60 seconds" },
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "script", 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: BriefInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Ограничение длины полей против prompt injection
  if (body.brandName) body.brandName = String(body.brandName).slice(0, 100);
  if (body.productDescription) body.productDescription = String(body.productDescription).slice(0, 500);
  if (body.targetAudience) body.targetAudience = String(body.targetAudience).slice(0, 300);
  if (body.directorVision) body.directorVision = String(body.directorVision).slice(0, 1000);

  const analysisContext = body.brandAnalysis
    ? `
Audience insights (from website analysis):
- Key pains: ${body.brandAnalysis.keyPains?.join(", ") ?? "—"}
- Key desires: ${body.brandAnalysis.keyDesires?.join(", ") ?? "—"}
- Emotional triggers: ${body.brandAnalysis.emotionalTriggers?.join(", ") ?? "—"}
- Recommended video angle: ${body.brandAnalysis.videoAngle ?? "—"}
- Tone of voice: ${body.brandAnalysis.toneOfVoice ?? "—"}
- Call to action: ${body.brandAnalysis.callToAction ?? "—"}`
    : "";

  const { scenes: sceneCount, total: totalDuration } =
    DURATION_PARAMS[body.videoDuration ?? "30-45"];

  const images = body.uploadedImages ?? [];
  const imageContext = images.length > 0
    ? `\nBrand assets provided (${images.filter(Boolean).length} images):
@Image1 = hero/model (face and body).
@Image2 = product FRONT (logo, front prints).
@Image3 = product BACK (back side, other prints).
@Image4 = brand logo (ALWAYS in final scene).
@Image5 = secondary product or accessory.
@Image6 = partner/collab logo (if exists).
CRITICAL: @Image2 and @Image3 show DIFFERENT SIDES of the same product — use @Image2 when subject faces camera, @Image3 when subject turns away. Both must appear naturally across scenes.
Use relevant @Image tags IN the visualPrompt text at the moment the asset appears — not at the end of the prompt.`
    : "";

  const videoRefContext = body.videoReference
    ? `

CINEMATIC REFERENCE ANALYSIS (replicate this visual style exactly):
- Camera style: ${body.videoReference.cameraStyle}
- Pacing: ${body.videoReference.pacing}
- Editing style: ${body.videoReference.editingStyle}
- Lighting: ${body.videoReference.lightingStyle}
- Color grade: ${body.videoReference.colorGrade}
- Camera movements to use: ${body.videoReference.cameraMovements.join(", ")}
- Shot types: ${body.videoReference.shotTypes.join(", ")}
- Mood keywords: ${body.videoReference.moodKeywords.join(", ")}
- Director note: ${body.videoReference.recommendations}

IMPORTANT: Replicate the EXACT camera choreography from the reference. For each scene pick ONE movement from: ${body.videoReference.cameraMovements.join(", ")}. Replace all characters/products with brand assets — keep motion choreography identical to reference. If reference has a dolly-in at scene 2, our scene 2 has a dolly-in. If reference has a 180° orbit — ours has it too. Subjects change, motion stays.`
    : "";

  // Режим режиссёрского видения: пользователь описал что хочет видеть
  const visionContext = body.directorVision?.trim()
    ? `\n\nDIRECTOR'S VISION (creator's own words, in Russian — translate the intention, not literally):\n"${body.directorVision.trim()}"\n\nIMPORTANT: The director's vision above is the PRIMARY creative brief. Structure the narrative arc around it. Keep brand identity but follow the vision.`
    : "";

  const platformContext = body.platform && PLATFORM_CONTEXT[body.platform]
    ? `\n\n${PLATFORM_CONTEXT[body.platform]}`
    : "";

  // Инструкция для 15-сек одиночного плана: Seedance 2.0 при генерации 15 сек
  // "думает" про предыдущий и следующий кадр внутри одного клипа — без монтажа.
  const singleShotInstruction = body.videoDuration === "15-single"
    ? `\nIMPORTANT — SINGLE CONTINUOUS SHOT MODE:
This is ONE 15-second clip with NO cuts. Seedance 2.0 will handle all internal transitions.
Structure the visualPrompt with 3 phases inside ONE scene:
"Phase 1 (0-5s): [visual hook, emotion, no product]. Phase 2 (5-10s): [product enters naturally]. Phase 3 (10-15s): [brand logo reveal, hold 2 sec]."
Write all three phases as ONE continuous visualPrompt. Do NOT write separate scenes.`
    : `\nNote: each scene is generated as a SEPARATE video clip and assembled in sequence. Write EXIT DIRECTION at the end of each scene's visualPrompt and ENTRY DIRECTION at the start of the next — so assembly feels seamless.`;

  const userMessage = `Brand: ${body.brandName}
Video type: ${body.videoType}
Product: ${body.productDescription}
Target audience: ${body.targetAudience}
Mood: ${body.mood}
Brand colors: ${body.brandColors || "not specified"}${imageContext}${analysisContext}${videoRefContext}${visionContext}${platformContext}${singleShotInstruction}

Write a ${sceneCount}-scene video script. Each scene 5-10 seconds. Total ~${totalDuration}.
${images.length > 0 ? "Include @Image tags IN the visualPrompt text at the moment the asset appears in the scene — not at the end of the prompt." : ""}
Return JSON array only. Example format:
[{"sceneNumber":1,"duration":"5 sec","description":"...","descriptionRu":"...","visualPrompt":"...","cameraMovement":"slow push-in","sceneType":"nature"}]`;

  const detectedNiche = detectNiche(
    body.brandName,
    body.productDescription,
    body.websiteContent
  );

  const nicheSystemAddendum = buildNicheSystemPrompt(detectedNiche, {
    brandName: body.brandName,
    productDescription: body.productDescription,
    targetAudience: body.targetAudience,
    mood: body.mood,
    brandImages: body.uploadedImages,
  });

  const combinedSystemPrompt = `${SYSTEM_PROMPT}\n\n${nicheSystemAddendum}`;

  const [geminiKey, groqKey, openrouterKey] = await Promise.all([
    resolveApiKey("gemini", process.env.GEMINI_API_KEY),
    resolveApiKey("groq", process.env.GROQ_API_KEY),
    resolveApiKey("openrouter", process.env.OPENROUTER_API_KEY),
  ]);

  const result = await aiCallWithQualityGate({
    task: "script",
    system: combinedSystemPrompt,
    user: userMessage,
    apiKeys: {
      gemini: geminiKey,
      groq: groqKey,
      openrouter: openrouterKey,
    },
  });

  if (!result.ok) {
    captureError(new Error(result.error ?? "AI generation failed"), { task: "script" });
    return NextResponse.json({ error: result.error ?? "AI generation failed" }, { status: 502 });
  }

  const raw = parseJSON(result.text);
  if (!raw) {
    captureError(new Error("Failed to parse script JSON"), { task: "script", text: result.text?.slice(0, 200) });
    return NextResponse.json({ error: "Failed to parse script JSON" }, { status: 500 });
  }

  // Groq/Gemini могут обернуть массив в объект с любым ключом — извлекаем
  const candidate: unknown = Array.isArray(raw)
    ? raw
    : (() => {
        const values = Object.values(raw as Record<string, unknown>);
        return values.find((v) => Array.isArray(v) && (v as unknown[]).length > 0) ?? raw;
      })();

  // Zod runtime validation — ловит любое несоответствие структуры
  const parsed = ScriptSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error("[script] Zod validation failed:", parsed.error.flatten());
    return NextResponse.json(
      { error: "Script format invalid", details: parsed.error.flatten() },
      { status: 500 }
    );
  }

  // guardScript: auto-repair ПЕРЕД возвратом клиенту
  // Исправляет: пустые промты, ненормализованные @Image теги, NSFW слова, отсутствие лого в финале
  const { scenes: repairedScript, repairs, warnings } = guardScript(parsed.data, {
    brandImagesCount: images.filter(Boolean).length,
  });
  if (repairs.length > 0) {
    console.log("[script] Pipeline guard repairs:", repairs);
  }
  if (warnings.length > 0) {
    console.warn("[script] Pipeline guard warnings:", warnings);
  }

  const qualityCheck = validateScriptQuality(repairedScript);
  if (!qualityCheck.valid) {
    console.warn("[script] Quality issues (post-repair):", qualityCheck.issues);
  }

  // BUG-015: добавить model в _meta
  const t0 = Date.now();
  return NextResponse.json({
    script: repairedScript,
    niche: detectedNiche,
    _meta: {
      score: result.score,
      attempts: result.attempts,
      escalated: result.escalated,
      model: result.model ?? "—",
      latencyMs: Date.now() - t0,
      repairs: repairs.length > 0 ? repairs : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  });
}
