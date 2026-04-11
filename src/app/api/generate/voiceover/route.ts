import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveApiKey } from "@/lib/user-keys";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// ElevenLabs multilingual_v2 — поддерживает русский язык
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

type VoiceoverInput = {
  mode: "script" | "audio" | "both";
  // Контекст для написания скрипта
  brandName?: string;
  mood?: string;
  productDescription?: string;
  targetAudience?: string;
  videoDuration?: string;
  scenes?: Array<{ sceneNumber: number; descriptionRu?: string; description?: string }>;
  // Для озвучки
  script?: string;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
};

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam — нейтральный, подходит для рекламы

async function generateScript(body: VoiceoverInput, geminiKey: string): Promise<string> {
  const durationMap: Record<string, string> = {
    "15-single": "15 секунд (одна непрерывная сцена)",
    "15-30": "15–30 секунд (3 сцены)",
    "30-45": "30–45 секунд (5 сцен)",
    "45-60": "45–60 секунд (7 сцен)",
  };
  const durationLabel = durationMap[body.videoDuration ?? "30-45"] ?? "30–45 секунд";

  const sceneSummary = body.scenes?.length
    ? `\nСцены ролика:\n${body.scenes.map((s) => `${s.sceneNumber}. ${s.descriptionRu ?? s.description ?? ""}`).join("\n")}`
    : "";

  const prompt = `Ты профессиональный копирайтер рекламных роликов.
Напиши текст для голосовой озвучки рекламного видео.

Бренд: ${body.brandName ?? ""}
Продукт: ${body.productDescription ?? ""}
Целевая аудитория: ${body.targetAudience ?? ""}
Настроение: ${body.mood ?? "Люкс"}
Длительность: ${durationLabel}${sceneSummary}

Требования:
- Текст зачитывается за ${body.videoDuration === "15-single" ? "10–12" : body.videoDuration === "15-30" ? "12–18" : body.videoDuration === "30-45" ? "25–35" : "40–50"} секунд (≈ ${body.videoDuration === "15-single" ? "25–30" : body.videoDuration === "15-30" ? "30–45" : body.videoDuration === "30-45" ? "65–90" : "100–130"} слов)
- Только текст для произношения вслух — без ремарок, скобок, инструкций
- Язык: русский, живой и естественный
- Тон: соответствует настроению "${body.mood ?? "Люкс"}"
- Финальный призыв к действию

Верни ТОЛЬКО текст озвучки, без объяснений.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty script");
  return text.trim();
}

async function generateAudio(
  script: string,
  voiceId: string,
  stability: number,
  similarityBoost: number,
  elevenKey: string
): Promise<ArrayBuffer> {
  const res = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": elevenKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err.substring(0, 200)}`);
  }

  return res.arrayBuffer();
}

async function uploadAudio(buf: ArrayBuffer, brandName: string): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const safeName = (brandName || "brand").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 20);
  const key = `voiceover/${safeName}-${Date.now()}.mp3`;

  const { error } = await supabase.storage
    .from("assets")
    .upload(key, Buffer.from(buf), { contentType: "audio/mpeg", upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from("assets").getPublicUrl(key);
  return data.publicUrl;
}

export async function POST(req: NextRequest) {
  // BUG-008: auth check — только авторизованные пользователи
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "voiceover", 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: VoiceoverInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // BUG-026: mode="both" требует script
  if (body.mode === "both" && !body.script?.trim()) {
    return NextResponse.json({ error: "script is required for mode=both" }, { status: 400 });
  }

  const geminiKey = (await resolveApiKey("gemini", process.env.GEMINI_API_KEY)) ?? "";
  const elevenKey = (await resolveApiKey("elevenlabs", process.env.ELEVENLABS_API_KEY)) ?? "";

  if (body.mode === "script" || body.mode === "both") {
    if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }
  if (body.mode === "audio" || body.mode === "both") {
    if (!elevenKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
    if (!body.script?.trim()) return NextResponse.json({ error: "script is required for audio mode" }, { status: 400 });
  }

  // BUG-036: voiceId валидация — только безопасные символы
  const rawVoiceId = body.voiceId || DEFAULT_VOICE_ID;
  if (body.voiceId && !/^[a-zA-Z0-9_-]{10,40}$/.test(body.voiceId)) {
    return NextResponse.json({ error: "Invalid voiceId format" }, { status: 400 });
  }
  const voiceId = rawVoiceId;
  const stability = Math.min(1, Math.max(0, body.stability ?? 0.5));
  const similarityBoost = Math.min(1, Math.max(0, body.similarityBoost ?? 0.75));

  try {
    let script = body.script ?? "";
    let audioUrl: string | undefined;

    if (body.mode === "script" || body.mode === "both") {
      script = await generateScript(body, geminiKey);
      console.log(`[voiceover] script generated: ${script.length} chars`);
    }

    if (body.mode === "audio" || body.mode === "both") {
      const audioBuf = await generateAudio(script, voiceId, stability, similarityBoost, elevenKey);
      audioUrl = await uploadAudio(audioBuf, body.brandName ?? "brand");
      console.log(`[voiceover] audio uploaded: ${audioUrl.substring(0, 80)}`);
    }

    return NextResponse.json({
      ...(script ? { script } : {}),
      ...(audioUrl ? { audioUrl } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[voiceover] error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
