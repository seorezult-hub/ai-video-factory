import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Gemini Vision анализирует загруженные фото бренда и извлекает:
// - HEX-цвета (доминирующие + акцент)
// - стиль и настроение
// - рекомендованный тип ролика

type BrandDNA = {
  brandColors: string;       // "золото #C9A84C, слоновая кость #F5F0E8, чёрный #1A1A1A"
  mood: string;              // один из: Люкс | Энергия | Мягко и натурально | Дерзко | Минимализм | Игриво
  videoType: string;         // cosmetics | fashion | food | tech | real_estate | music
  styleNotes: string;        // 1-2 предложения о визуальной эстетике бренда
};

const MOODS = ["Люкс", "Энергия", "Мягко и натурально", "Дерзко", "Минимализм", "Игриво"];
const VIDEO_TYPES = ["cosmetics", "fashion", "food", "music", "tech", "real_estate"];

export async function POST(req: NextRequest) {
  let body: { imageUrls: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validUrls = (body.imageUrls ?? []).filter((u) => u && u.length > 0).slice(0, 4);
  if (validUrls.length === 0) {
    return NextResponse.json({ error: "No image URLs provided" }, { status: 400 });
  }

  const { resolveApiKey } = await import("@/lib/user-keys");
  const geminiKey = await resolveApiKey("gemini", process.env.GEMINI_API_KEY);
  if (!geminiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  // Gemini Vision через URL (не inline base64 — edge runtime не имеет Buffer)
  const imageParts = validUrls.map((url) => ({
    fileData: { mimeType: "image/jpeg", fileUri: url },
  }));

  const textPart = {
    text: `You are a brand visual identity analyst.
Analyze these brand images (product shots, hero photos, logos) and extract the visual DNA.

Available moods: ${MOODS.join(" | ")}
Available video types: ${VIDEO_TYPES.join(" | ")}

Return ONLY valid JSON:
{
  "brandColors": "color name #HEX, color name #HEX, color name #HEX (2-4 dominant colors with hex codes)",
  "mood": "<one of the available moods that best matches>",
  "videoType": "<one of the available video types that best matches>",
  "styleNotes": "1-2 sentences describing the visual aesthetic and brand feel"
}`,
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...imageParts, textPart] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`[brand-dna] Gemini error: ${res.status} ${err.substring(0, 200)}`);
      return NextResponse.json({ error: `Gemini Vision error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      return NextResponse.json({ error: "Empty Gemini response" }, { status: 502 });
    }

    let dna: BrandDNA;
    try {
      dna = JSON.parse(text) as BrandDNA;
    } catch (parseErr) {
      console.error("[brand-dna] JSON.parse failed:", parseErr, "raw text:", text.substring(0, 200));
      return NextResponse.json({ error: "Failed to parse Gemini response as JSON" }, { status: 502 });
    }

    // Валидируем mood и videoType
    if (!MOODS.includes(dna.mood)) dna.mood = "Люкс";
    if (!VIDEO_TYPES.includes(dna.videoType)) dna.videoType = "cosmetics";

    console.log(`[brand-dna] extracted: mood=${dna.mood} type=${dna.videoType} colors=${dna.brandColors.substring(0, 40)}`);
    return NextResponse.json({ dna });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[brand-dna] error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
