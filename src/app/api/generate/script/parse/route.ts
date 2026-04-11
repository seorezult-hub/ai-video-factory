import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJSON } from "@/lib/ai-router";
import { aiCallWithQualityGate } from "@/lib/ai-validator";
import { resolveApiKey } from "@/lib/user-keys";
import { guardScript } from "@/lib/pipeline-guard";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

const SceneSchema = z.object({
  sceneNumber: z.number(),
  duration: z.string(),
  description: z.string(),
  descriptionRu: z.string().optional(),
  visualPrompt: z.string(),
  cameraMovement: z.string(),
});

const ScriptSchema = z.array(SceneSchema);

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a professional video director adapting a written script into a visual scene breakdown.
Given a text script, split it into the exact number of scenes requested. Return ONLY a valid JSON array, no markdown, no explanation.

Each scene object must have:
- sceneNumber (number)
- duration ("5 sec" or "10 sec")
- description (what happens in this scene, 1-2 sentences in English — based on script content)
- descriptionRu (same as description but in Russian, 1-2 sentences)
- visualPrompt (60-80 words: Subject + Action + Environment/Lighting + Camera Movement + Style — translate script content into visual language)
- cameraMovement (one of: slow push-in, tracking shot, static, slow orbit, dolly back, overhead, rack focus)

Important: distribute the script content evenly across all scenes. Each scene should cover a distinct portion of the script.`;

const DURATION_PARAMS: Record<string, { scenes: number; total: string }> = {
  "15-single": { scenes: 1, total: "15 seconds continuous, single shot" },
  "15-30": { scenes: 3, total: "15–30 seconds" },
  "30-45": { scenes: 5, total: "30–45 seconds" },
  "45-60": { scenes: 7, total: "45–60 seconds" },
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "parse", 10);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: {
    scriptText: string;
    videoDuration?: "15-single" | "15-30" | "30-45" | "45-60";
    brandName?: string;
    brandColors?: string;
    mood?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.scriptText?.trim()) {
    return NextResponse.json({ error: "Текст сценария не может быть пустым" }, { status: 400 });
  }

  const truncated = body.scriptText.slice(0, 3000);
  const { scenes: sceneCount, total: totalDuration } =
    DURATION_PARAMS[body.videoDuration ?? "30-45"] ?? DURATION_PARAMS["30-45"];

  const userMessage = `Brand: ${body.brandName || "unknown"}
Mood: ${body.mood || "not specified"}
Brand colors: ${body.brandColors || "not specified"}
Target video duration: ~${totalDuration}

Here is the existing script to adapt into exactly ${sceneCount} visual scenes:

---
${truncated}
---

Distribute the script content evenly across exactly ${sceneCount} scenes. Each scene 5-10 seconds.
Return JSON array only. Example format:
[{"sceneNumber":1,"duration":"5 sec","description":"...","descriptionRu":"...","visualPrompt":"...","cameraMovement":"slow push-in"}]`;

  const [groqKey, geminiKey] = await Promise.all([
    resolveApiKey("groq", process.env.GROQ_API_KEY),
    resolveApiKey("gemini", process.env.GEMINI_API_KEY),
  ]);

  if (!groqKey && !geminiKey) {
    return NextResponse.json({ error: "Нет API ключей для генерации (GROQ_API_KEY или GEMINI_API_KEY)" }, { status: 500 });
  }

  const result = await aiCallWithQualityGate({
    task: "script",
    system: SYSTEM_PROMPT,
    user: userMessage,
    apiKeys: { groq: groqKey ?? undefined, gemini: geminiKey ?? undefined },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "AI generation failed" }, { status: 502 });
  }

  const raw = parseJSON(result.text);
  if (!raw) {
    return NextResponse.json({ error: "Failed to parse script JSON" }, { status: 500 });
  }

  const candidate: unknown = Array.isArray(raw)
    ? raw
    : (() => {
        const values = Object.values(raw as Record<string, unknown>);
        return values.find((v) => Array.isArray(v) && (v as unknown[]).length > 0) ?? raw;
      })();

  const parsed = ScriptSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error("[parse] Zod validation failed:", parsed.error.flatten());
    return NextResponse.json(
      { error: "Script format invalid", details: parsed.error.flatten() },
      { status: 500 }
    );
  }

  const scenes = parsed.data;

  // Исправляем количество сцен если AI вернул неверное число:
  // — слишком много → обрезаем до нужного
  // — слишком мало → дублируем последнюю сцену с новым номером (лучше чем падать)
  if (scenes.length === 0) {
    return NextResponse.json({ error: "AI вернул пустой массив сцен" }, { status: 500 });
  }
  let fixedScenes = scenes;
  if (scenes.length > sceneCount) {
    fixedScenes = scenes.slice(0, sceneCount);
  } else if (scenes.length < sceneCount) {
    const last = scenes[scenes.length - 1];
    while (fixedScenes.length < sceneCount) {
      fixedScenes = [
        ...fixedScenes,
        { ...last, sceneNumber: fixedScenes.length + 1 },
      ];
    }
  }

  // Перенумеровываем на случай если sceneNumber пришёл неверно
  fixedScenes = fixedScenes.map((s, i) => ({ ...s, sceneNumber: i + 1 }));

  // guardScript: auto-repair visualPrompt, NSFW sanitize, duration fix
  const { scenes: guardedScenes, repairs, warnings } = guardScript(fixedScenes);
  if (repairs.length > 0) console.log("[parse] guardScript repairs:", repairs);
  if (warnings.length > 0) console.warn("[parse] guardScript warnings:", warnings);

  return NextResponse.json({
    script: guardedScenes,
    _meta: { score: result.score, attempts: result.attempts, escalated: result.escalated, repairs, warnings },
  });
}
