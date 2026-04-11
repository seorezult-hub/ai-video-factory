/**
 * POST /api/analyze/youtube
 *
 * Принимает YouTube URL → Gemini смотрит видео целиком → возвращает:
 * 1. Сценарий сцен (готов к импорту в wizard)
 * 2. Визуальный стиль (цвет, камера, монтаж, настроение)
 * 3. Рекомендации для промтов
 *
 * Использует Gemini 2.0 Flash нативную поддержку YouTube URL —
 * никакого скачивания, yt-dlp или FFmpeg не нужно.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0];
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

function isYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

const SCRIPT_EXTRACTION_PROMPT = `You are a creative director and cinematography analyst for premium brand commercials.

Watch this video carefully and extract a complete scene-by-scene storyboard.

Return ONLY valid JSON with this exact structure:
{
  "videoStyle": {
    "cameraStyle": "brief description of overall camera approach",
    "pacing": "edit rhythm, e.g. '1 cut per 3-4 seconds, slow and deliberate'",
    "editingStyle": "transition types, e.g. 'cross-dissolves, match cuts, jump cuts'",
    "lightingStyle": "main lighting approach, e.g. 'warm golden rim light, high contrast'",
    "colorGrade": "dominant color palette, e.g. 'warm ambers and deep blacks, teal shadows'",
    "moodKeywords": ["5 mood keywords"],
    "cameraMovements": ["list of movements used: slow push-in | tracking shot | static | slow orbit | dolly back | overhead | rack focus"],
    "shotTypes": ["list: extreme close-up | close-up | medium shot | wide shot | overhead"],
    "recommendations": "2-3 sentence director's note on how to replicate this exact visual style in AI video prompts"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "5 sec",
      "description": "Brief description of what happens in this scene in English",
      "descriptionRu": "То же самое по-русски — что происходит в этой сцене",
      "visualPrompt": "Detailed 60-100 word visual prompt for Seedance 2.0 AI video generation. Include: subject + setting, lighting (specific type and direction), camera movement (ONE only), style keywords, what to avoid. End with EXIT DIRECTION: EXITS FRAME [direction] or ENDS ON [element].",
      "cameraMovement": "slow push-in",
      "sceneType": "nature"
    }
  ],
  "niche": "detected niche: cosmetics | fashion | luxury | food | fitness | tech | real_estate | music",
  "suggestedMood": "Люкс | Энергия | Мягко и натурально | Дерзко | Минимализм | Игриво",
  "totalDuration": "estimated total video duration in seconds"
}

Rules for scenes:
- Extract 3-7 scenes depending on video length
- Each scene = one distinct cut or visual beat
- cameraMovement must be ONE of: slow push-in | tracking shot | static | slow orbit | dolly back | overhead | rack focus
- sceneType must be ONE of: nature | product | face | action | logo | unknown
- visualPrompt: describe MOTION over time, not static frame. Write for AI video generation.
- Include EXIT/ENTRY directions between consecutive scenes for seamless assembly
- If video has brand assets, note them as @Image1, @Image2 etc. placeholders

Focus on: camera choreography, lighting setups, color grading, editing rhythm, emotional arc.`;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "analyze", 5);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { youtubeUrl: string; context?: { brandName?: string; niche?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { youtubeUrl, context } = body;

  if (!youtubeUrl || !isYouTubeUrl(youtubeUrl)) {
    return NextResponse.json(
      { error: "Нужна валидная ссылка YouTube (youtube.com/watch?v=... или youtu.be/...)" },
      { status: 400 }
    );
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY не настроен" }, { status: 500 });
  }

  const contextBlock = context?.brandName || context?.niche
    ? `\n\nContext: brand="${context.brandName ?? "unknown"}", niche="${context.niche ?? "unknown"}". Use this context when writing visualPrompts and suggesting how to adapt the style for this brand.`
    : "";

  const prompt = SCRIPT_EXTRACTION_PROMPT + contextBlock;

  console.log(`[youtube-analyze] analyzing: ${youtubeUrl}`);

  // Gemini 2.0 Flash нативно понимает YouTube URL через fileData
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  mimeType: "video/mp4",
                  fileUri: youtubeUrl,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    console.error("[youtube-analyze] Gemini error:", errText.slice(0, 300));

    // Gemini может не поддерживать этот видос (приватный, регион и т.д.)
    if (errText.includes("400") || errText.includes("not supported") || errText.includes("INVALID")) {
      return NextResponse.json(
        {
          error: "Gemini не может прочитать это видео. Проверь: видео публичное, не возрастное ограничение, доступно в вашем регионе.",
          geminiError: errText.slice(0, 200),
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { error: `Gemini API error: ${geminiRes.status}` },
      { status: 502 }
    );
  }

  const geminiData = await geminiRes.json();
  const rawText: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!rawText) {
    return NextResponse.json({ error: "Gemini вернул пустой ответ" }, { status: 500 });
  }

  let parsed: {
    videoStyle: object;
    scenes: Array<{
      sceneNumber: number;
      duration: string;
      description: string;
      descriptionRu?: string;
      visualPrompt: string;
      cameraMovement: string;
      sceneType: string;
    }>;
    niche: string;
    suggestedMood: string;
    totalDuration: string;
  };

  try {
    // Gemini с responseMimeType=json возвращает чистый JSON
    parsed = JSON.parse(rawText);
  } catch {
    // Иногда обёртывает в markdown ```json ... ```
    const match = rawText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) {
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        return NextResponse.json({ error: "Не удалось распарсить ответ Gemini" }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: "Не удалось распарсить ответ Gemini" }, { status: 500 });
    }
  }

  if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    return NextResponse.json({ error: "Gemini не нашёл сцен в видео" }, { status: 500 });
  }

  console.log(`[youtube-analyze] extracted ${parsed.scenes.length} scenes, niche=${parsed.niche}`);

  return NextResponse.json({
    scenes: parsed.scenes,
    videoStyle: parsed.videoStyle,
    niche: parsed.niche,
    suggestedMood: parsed.suggestedMood,
    totalDuration: parsed.totalDuration,
    youtubeUrl,
  });
}
