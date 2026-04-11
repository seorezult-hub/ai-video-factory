import { NextRequest, NextResponse } from "next/server";
import { aiCall, parseJSON } from "@/lib/ai-router";
import { resolveApiKey } from "@/lib/user-keys";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const SYSTEM = `You are a creative director at a top-tier brand video production studio.
Your job: ask 3-5 smart questions to extract exactly what's needed to create a premium brand video.

Rules:
- Questions must be SHORT and SPECIFIC — not generic
- Each question unlocks a creative decision (visual, emotional, or strategic)
- Adapt questions to the niche and what's ALREADY provided
- Ask about: mood/feeling, target moment (where will viewer be), hero/protagonist, desired emotion after watching, one surprising visual detail they want
- NEVER ask about things already provided in the brief
- Output in Russian

Return JSON: { "questions": ["q1", "q2", "q3", ...] }
Maximum 5 questions.`;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "script", 10);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: {
    videoType?: string;
    brandName?: string;
    productDescription?: string;
    mood?: string;
    targetAudience?: string;
    hasImages?: boolean;
    platform?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const geminiKey = await resolveApiKey("gemini", process.env.GEMINI_API_KEY);

  const filledFields = [
    body.brandName && `Бренд: ${body.brandName}`,
    body.videoType && `Ниша: ${body.videoType}`,
    body.productDescription && `Продукт: ${body.productDescription}`,
    body.mood && `Настроение: ${body.mood}`,
    body.targetAudience && `Аудитория: ${body.targetAudience}`,
    body.hasImages && "Ассеты: загружены фото",
    body.platform && `Платформа: ${body.platform}`,
  ].filter(Boolean).join("\n");

  const missingFields = [
    !body.mood && "настроение видео",
    !body.targetAudience && "целевая аудитория",
    !body.platform && "платформа публикации",
  ].filter(Boolean);

  const userMessage = `Brief so far:
${filledFields || "Почти пусто — задай базовые вопросы"}

Missing fields: ${missingFields.join(", ") || "всё заполнено — уточни детали для качества"}

Generate smart creative questions to improve the video outcome.`;

  const result = await aiCall({
    task: "questions",
    system: SYSTEM,
    user: userMessage,
    maxTokens: 600,
    jsonMode: true,
    apiKeys: { gemini: geminiKey },
  });

  if (!result.ok) {
    return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  }

  const parsed = parseJSON<{ questions: string[] }>(result.text);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    return NextResponse.json({ error: "Invalid response" }, { status: 500 });
  }

  return NextResponse.json({ questions: parsed.questions.slice(0, 5) });
}
