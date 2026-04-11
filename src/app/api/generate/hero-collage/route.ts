import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const PIAPI_IMAGINE_URL = "https://api.piapi.ai/mj/v2/imagine";
const PIAPI_FETCH_URL   = "https://api.piapi.ai/mj/v2/fetch";

function fetchWithTimeout(url: string, options: RequestInit, ms = 30_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

type HeroCollageInput = {
  heroImageUrl: string;   // @Image1 — uploaded face/body reference
  brandName:   string;
  mood:        string;
  productDescription: string;
  videoType?:  string;
};

function buildMJPrompt(input: HeroCollageInput): string {
  const moodMap: Record<string, string> = {
    "Люкс":                 "luxury editorial fashion, dark cinematic backdrop, dramatic lighting",
    "Энергия":              "dynamic sport energy, bold neon accents, motion blur background",
    "Мягко и натурально":   "soft natural light, airy lifestyle, clean minimalist studio",
    "Дерзко":               "bold street fashion, high contrast, edgy urban aesthetics",
    "Минимализм":           "clean minimalist white studio, pure light, geometric shadows",
    "Игриво":               "playful bright colors, fun lifestyle setting, natural smile",
  };

  const style = moodMap[input.mood] ?? "luxury editorial fashion, cinematic lighting";

  return (
    `${input.brandName} brand hero, full body portrait, ${style}, ` +
    `professional commercial photography, sharp focus, 8k quality, ` +
    `photorealistic, brand ambassador`
  );
}

export async function POST(req: NextRequest) {
  let body: HeroCollageInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { resolveApiKey } = await import("@/lib/user-keys");
  const piApiKey = await resolveApiKey("piapi", process.env.PIAPI_KEY);
  if (!piApiKey) {
    return NextResponse.json({ error: "PIAPI_KEY not configured" }, { status: 500 });
  }

  if (!body.heroImageUrl || !body.brandName) {
    return NextResponse.json({ error: "heroImageUrl and brandName are required" }, { status: 400 });
  }

  const prompt = buildMJPrompt(body);
  // --cref injects face reference from the uploaded hero photo
  const mjPrompt = `${prompt} --cref ${body.heroImageUrl} --cw 100 --ar 9:16 --v 7 --style raw --q 2`;

  console.log(`[hero-collage] submitting MJ v7 --cref for brand: ${body.brandName}`);

  let submitData: { task_id?: string };
  try {
    const submitRes = await fetchWithTimeout(PIAPI_IMAGINE_URL, {
      method: "POST",
      headers: {
        "x-api-key": piApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: mjPrompt,
        process_mode: "fast",
      }),
    }, 30_000);

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error(`[hero-collage] piapi submit failed: ${submitRes.status} ${errText}`);
      return NextResponse.json({ error: `piapi.ai error: ${submitRes.status}` }, { status: 502 });
    }

    submitData = await submitRes.json();
  } catch (e) {
    return NextResponse.json({ error: `piapi.ai unreachable: ${e instanceof Error ? e.message : "timeout"}` }, { status: 502 });
  }

  const taskId = submitData.task_id;
  if (!taskId) {
    return NextResponse.json({ error: "piapi.ai returned no task_id" }, { status: 502 });
  }

  console.log(`[hero-collage] task submitted: ${taskId}`);

  // Poll до 90 сек (MJ v7 fast: обычно 30-60 сек)
  for (let attempt = 0; attempt < 23; attempt++) {
    await new Promise((r) => setTimeout(r, 4_000));

    let fetchData: {
      status?: string;
      task_result?: { image_urls?: string[]; image_url?: string };
    };

    try {
      const fetchRes = await fetchWithTimeout(PIAPI_FETCH_URL, {
        method: "POST",
        headers: {
          "x-api-key": piApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ task_id: taskId }),
      }, 15_000);

      if (!fetchRes.ok) continue;
      fetchData = await fetchRes.json();
    } catch {
      continue;
    }

    if (fetchData.status === "finished") {
      // MJ возвращает массив из 4 вариантов
      const imageUrls: string[] = fetchData.task_result?.image_urls ?? [];
      const single = fetchData.task_result?.image_url;
      if (imageUrls.length === 0 && single) imageUrls.push(single);

      if (imageUrls.length === 0) {
        return NextResponse.json({ error: "MJ finished but no image URLs" }, { status: 502 });
      }

      console.log(`[hero-collage] done, ${imageUrls.length} variants`);
      return NextResponse.json({ variants: imageUrls, taskId });
    }

    if (fetchData.status === "failed") {
      console.error(`[hero-collage] MJ task failed`);
      return NextResponse.json({ error: "Midjourney generation failed" }, { status: 502 });
    }

    console.log(`[hero-collage] attempt ${attempt + 1}/23, status=${fetchData.status}`);
  }

  return NextResponse.json({ error: "Midjourney timeout (90 sec)" }, { status: 504 });
}
