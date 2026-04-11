import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type SlotType = "hero" | "product" | "logo" | "detail" | "other";

const SLOT_CRITERIA: Record<SlotType, string> = {
  hero: "Person/model sharp and recognizable, clean white or neutral background, professional studio lighting, portrait or full body",
  product: "Product clearly visible from front, white or neutral background, even softbox lighting, no clutter or shadows",
  logo: "Logo clearly legible, clean or transparent background, high resolution, no blur or compression artifacts",
  detail: "Sharp macro focus on texture or detail, clean background, good lighting depth",
  other: "Clear main subject, balanced lighting, clean composition",
};

type ScoreResult = {
  score: number;
  grade: "A" | "B" | "C" | "F";
  feedback: string;
  tips: string[];
};

const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0)/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json<ScoreResult>({ score: 75, grade: "B", feedback: "Gemini не настроен — оценка пропущена", tips: [] });
  }

  let body: { imageUrl: string; slotType?: SlotType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { imageUrl, slotType = "other" } = body;
  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
  }

  // SSRF protection
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
    if (PRIVATE_IP_RE.test(parsedUrl.hostname)) {
      return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Fetch image
  let imgBuf: ArrayBuffer;
  let mimeType: string;
  try {
    const imgRes = await fetch(parsedUrl.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (imgRes.status >= 300 && imgRes.status < 400) {
      return NextResponse.json<ScoreResult>({ score: 0, grade: "F", feedback: "SSRF: redirect blocked", tips: [] });
    }
    if (!imgRes.ok) {
      return NextResponse.json<ScoreResult>({ score: 50, grade: "C", feedback: "Не удалось загрузить изображение", tips: ["Проверь URL доступности"] });
    }
    imgBuf = await imgRes.arrayBuffer();
    mimeType = imgRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  } catch {
    return NextResponse.json<ScoreResult>({ score: 50, grade: "C", feedback: "Ошибка загрузки", tips: [] });
  }

  const b64 = Buffer.from(imgBuf).toString("base64");
  const criteria = SLOT_CRITERIA[slotType];

  const scoringPrompt = `You are a professional asset quality assessor for AI video production.

Score this image for use as "${slotType}" reference photo in a high-quality commercial video.

Score each criterion out of 25 points:
1. Subject sharpness & clarity — main subject sharp, well-defined, in focus
2. Background quality — clean, neutral, or seamless (white/grey preferred)
3. Lighting quality — even, professional, no harsh shadows or overexposure
4. Resolution & composition — high enough resolution, well-framed

Slot-specific requirements: ${criteria}

Return ONLY valid JSON, no markdown:
{"score":<total 0-100>,"grade":<"A" if >=85, "B" if 70-84, "C" if 50-69, "F" if <50>,"feedback":"<one concise sentence in Russian>","tips":["<tip in Russian>","<tip in Russian>"]}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType, data: b64 } },
              { text: scoringPrompt },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json<ScoreResult>({ score: 70, grade: "B", feedback: "Gemini не смог оценить изображение", tips: [] });
    }

    const result = JSON.parse(text) as ScoreResult;
    return NextResponse.json<ScoreResult>(result);
  } catch {
    return NextResponse.json<ScoreResult>({ score: 70, grade: "B", feedback: "Ошибка оценки", tips: [] });
  }
}
