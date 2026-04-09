import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SYSTEM_PROMPT = `You are a professional video scriptwriter for brand commercials.
Write a 5-6 scene video script using this structure for each scene:
- sceneNumber (1-6)
- duration ("5 sec" or "10 sec")
- description (what happens, 1-2 sentences in English)
- visualPrompt (Seedance 2.0 optimized prompt: Subject + Action + Environment + Camera Movement + Style. 60-80 words. Include @Image1 as main product/model if images provided)
- cameraMovement (one of: slow push-in, tracking shot, static, slow orbit, dolly back, overhead)

Return ONLY valid JSON array. No markdown, no explanation.`;

type BriefInput = {
  videoType: string;
  brandName: string;
  brandColors: string;
  mood: string;
  targetAudience: string;
  productDescription: string;
};

export async function POST(req: NextRequest) {
  const body: BriefInput = await req.json();

  const userMessage = `
Brand: ${body.brandName}
Video type: ${body.videoType}
Product: ${body.productDescription}
Target audience: ${body.targetAudience}
Mood: ${body.mood}
Brand colors: ${body.brandColors || "not specified"}

Write a 5-scene video script. Each scene 5-10 seconds. Total ~30-45 seconds.
Return JSON array only.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Gemini API error: ${err}` }, { status: 502 });
  }

  const geminiData = await res.json();
  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/```json\n?|\n?```/g, "").trim();

  let script;
  try {
    script = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse script JSON", raw: rawText },
      { status: 500 }
    );
  }

  return NextResponse.json({ script });
}
