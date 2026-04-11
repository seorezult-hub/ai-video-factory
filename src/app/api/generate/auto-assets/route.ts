import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 180;

const PIAPI_BASE = "https://api.piapi.ai/api/v1";
const FAL_RECRAFT = "https://queue.fal.run/fal-ai/recraft-v3";
const FAL_POLL = "https://queue.fal.run/fal-ai/recraft-v3/requests";

type AutoAssetsInput = {
  brandName: string;
  productDescription: string;
  targetAudience: string;
  mood: string;
  videoType: string;
  brandColors?: string;
  aspectRatio?: string;
};

type HeroProfile = {
  gender: "female" | "male";
  age: string;
  look: string;
  outfit: string;
  pose: string;
};

// ─── Строим профиль героя из бриф данных ────────────────────────────────────
function buildHeroProfile(input: AutoAssetsInput): HeroProfile {
  const { targetAudience, mood, videoType, productDescription } = input;
  const audienceLower = targetAudience.toLowerCase();
  const productLower = productDescription.toLowerCase();

  // Пол
  const isFemale =
    audienceLower.includes("женщин") ||
    audienceLower.includes("девуш") ||
    audienceLower.includes("female") ||
    audienceLower.includes("women") ||
    videoType === "cosmetics" ||
    videoType === "fashion" ||
    (!audienceLower.includes("мужчин") && !audienceLower.includes("парен") && !audienceLower.includes("male") &&
      (videoType === "cosmetics" || videoType === "food"));

  const gender: "female" | "male" = isFemale ? "female" : "male";

  // Возраст из аудитории
  const ageMatch = targetAudience.match(/(\d{2})\s*[-–]\s*(\d{2})/);
  const agePlus = targetAudience.match(/(\d{2})\+/);
  let age = gender === "female" ? "28-35 years old" : "28-38 years old";
  if (ageMatch) {
    const mid = Math.round((parseInt(ageMatch[1]) + parseInt(ageMatch[2])) / 2);
    age = `${mid - 3}-${mid + 3} years old`;
  } else if (agePlus) {
    age = `${agePlus[1]}-${parseInt(agePlus[1]) + 12} years old`;
  }

  // Образ и стиль из настроения
  const moodProfiles: Record<string, { look: string; outfit: string; pose: string }> = {
    "Люкс": {
      look: "elegant, refined, sophisticated, impeccable grooming, glowing skin, subtle makeup",
      outfit: gender === "female"
        ? "wearing a luxurious silk dress or tailored blazer, minimal gold jewelry"
        : "wearing a tailored dark suit, white shirt, premium watch",
      pose: "poised, confident, graceful, relaxed elegance",
    },
    "Энергия": {
      look: "athletic, vibrant, glowing, healthy, energetic expression, natural confidence",
      outfit: gender === "female"
        ? "wearing modern activewear or casual chic outfit"
        : "wearing athletic wear or smart casual outfit",
      pose: "dynamic, active pose, confident smile, forward energy",
    },
    "Мягко и натурально": {
      look: "fresh, natural beauty, minimal makeup, healthy glowing skin, gentle expression",
      outfit: gender === "female"
        ? "wearing soft linen or organic cotton dress, earth tones"
        : "wearing casual linen shirt, natural tones",
      pose: "soft, relaxed, natural smile, approachable",
    },
    "Дерзко": {
      look: "bold, striking, high-contrast features, intense gaze, editorial look",
      outfit: gender === "female"
        ? "wearing avant-garde fashion, bold colors or structured silhouette"
        : "wearing edgy streetwear or structured jacket",
      pose: "powerful stance, direct gaze, commanding presence",
    },
    "Минимализм": {
      look: "clean, understated beauty, flawless skin, minimal styling, effortless",
      outfit: gender === "female"
        ? "wearing clean white or neutral minimal dress"
        : "wearing minimal white shirt or monochrome outfit",
      pose: "calm, composed, understated confidence",
    },
    "Игриво": {
      look: "playful expression, bright smile, warm approachable energy, expressive eyes",
      outfit: gender === "female"
        ? "wearing colorful contemporary fashion"
        : "wearing casual colorful outfit",
      pose: "playful smile, relaxed and joyful energy",
    },
  };

  const profile = moodProfiles[mood] ?? moodProfiles["Люкс"];

  // Добавляем контекст продукта
  let productContext = "";
  if (productLower.includes("парфюм") || productLower.includes("одеколон") || productLower.includes("perfume")) {
    productContext = gender === "female"
      ? ", holding a perfume bottle elegantly"
      : ", holding a cologne bottle with confidence";
  } else if (productLower.includes("крем") || productLower.includes("сывор") || productLower.includes("serum")) {
    productContext = ", with radiant glowing skin that reflects the product's effect";
  } else if (productLower.includes("часы") || productLower.includes("watch")) {
    productContext = ", showcasing a premium watch on wrist";
  } else if (productLower.includes("сумк") || productLower.includes("bag") || productLower.includes("handbag")) {
    productContext = ", holding a luxury handbag";
  }

  return {
    gender,
    age,
    look: profile.look + productContext,
    outfit: profile.outfit,
    pose: profile.pose,
  };
}

// ─── Строим MJ промт для фотореалистичного героя ───────────────────────────
function buildHeroMJPrompt(profile: HeroProfile, brandName: string): string {
  const genderWord = profile.gender === "female" ? "beautiful woman" : "handsome man";
  // КРИТИЧНО: hyperrealistic photographic portrait + --style raw = никакой мультяшности
  return `/imagine prompt: hyperrealistic photographic portrait of a ${profile.age} ${genderWord}, ${profile.look}, ${profile.outfit}, ${profile.pose}, white seamless studio background, professional studio lighting with softboxes, shot on Sony A7R V with 85mm f/1.4 lens, shallow depth of field, commercial advertising photography for ${brandName || "premium brand"}, ultra sharp focus on face, skin texture visible, photorealistic, 8K resolution --ar 2:3 --v 7 --style raw --q 2`;
}

// ─── Строим промт для продуктового фото (Recraft V3) ────────────────────────
function buildProductPrompt(input: AutoAssetsInput): string {
  const moodToLighting: Record<string, string> = {
    "Люкс": "luxury studio lighting, gold accent reflections, premium atmosphere",
    "Энергия": "bright energetic lighting, clean and vivid",
    "Мягко и натурально": "soft natural daylight, organic feel, gentle shadows",
    "Дерзко": "dramatic high-contrast studio lighting, bold shadows",
    "Минимализм": "minimal clean studio lighting, pure white background, soft shadows",
    "Игриво": "bright cheerful lighting, colorful soft background",
  };
  const lighting = moodToLighting[input.mood] ?? "professional studio lighting";

  return `${input.productDescription}, product photography, front view, isolated on pure white background, ${lighting}, ultra sharp focus, no reflections on product surface, commercial advertising shot, 8K resolution`;
}

// ─── piapi.ai: submit MJ задачу ─────────────────────────────────────────────
async function submitMidjourney(prompt: string, piApiKey: string): Promise<string> {
  const res = await fetch(`${PIAPI_BASE}/task`, {
    method: "POST",
    headers: { "x-api-key": piApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "midjourney",
      task_type: "imagine",
      input: { prompt },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`piapi submit failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const taskId = data?.data?.task_id ?? data?.task_id;
  if (!taskId) throw new Error("piapi: no task_id");
  return taskId as string;
}

// ─── piapi.ai: poll до готовности ───────────────────────────────────────────
// BUG-011: таймаут polling 150 сек < maxDuration 180 сек
const POLL_TIMEOUT_MS = 150_000;

async function pollMidjourney(taskId: string, piApiKey: string): Promise<string[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000)); // MJ медленнее — 5с интервал
    if (Date.now() > deadline) throw new Error("piapi polling timeout (150s)");
    const res = await fetch(`${PIAPI_BASE}/task/${taskId}`, {
      headers: { "x-api-key": piApiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const status = data?.data?.status ?? data?.status;
    const output = data?.data?.output ?? data?.output;

    if (status === "completed" || status === "success") {
      const imageUrls: string[] = output?.image_urls ?? [];
      // MJ возвращает 4 варианта — берём все
      if (imageUrls.length > 0) return imageUrls;
      // Fallback: единый grid → split URL
      if (output?.image_url) return [output.image_url];
      throw new Error("piapi: no images in output");
    }
    if (status === "failed" || status === "error") {
      throw new Error(`piapi task failed: ${data?.data?.error ?? "unknown"}`);
    }
  }
  throw new Error("piapi polling timeout");
}

// ─── fal.ai Recraft V3: submit ───────────────────────────────────────────────
async function submitRecraft(prompt: string, falKey: string): Promise<string> {
  const res = await fetch(FAL_RECRAFT, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      style: "realistic_image",
      image_size: { width: 1024, height: 1024 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Recraft submit failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.request_id as string;
}

// ─── fal.ai Recraft V3: poll ─────────────────────────────────────────────────
async function pollRecraft(requestId: string, falKey: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (Date.now() > deadline) throw new Error("Recraft polling timeout (150s)");
    const res = await fetch(`${FAL_POLL}/${requestId}/status`, {
      headers: { Authorization: `Key ${falKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const { status } = await res.json();
    if (status === "COMPLETED") {
      const resultRes = await fetch(`${FAL_POLL}/${requestId}`, {
        headers: { Authorization: `Key ${falKey}` },
      });
      const result = await resultRes.json();
      const url = result?.images?.[0]?.url ?? result?.image?.url;
      if (!url) throw new Error("Recraft: no image URL");
      return url as string;
    }
    if (status === "FAILED") throw new Error("Recraft generation failed");
  }
  throw new Error("Recraft polling timeout");
}

// ─── Основной обработчик ─────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "auto-assets", 3);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const { resolveApiKey } = await import("@/lib/user-keys");
  const [piApiKey, falKey] = await Promise.all([
    resolveApiKey("piapi", process.env.PIAPI_KEY),
    resolveApiKey("fal", process.env.FAL_API_KEY),
  ]);

  if (!piApiKey && !falKey) {
    return NextResponse.json({ error: "Нет PIAPI_KEY или FAL_API_KEY" }, { status: 500 });
  }

  let body: AutoAssetsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { brandName, productDescription, targetAudience, mood, videoType } = body;
  if (!productDescription || !targetAudience || !mood) {
    return NextResponse.json({ error: "productDescription, targetAudience, mood обязательны" }, { status: 400 });
  }

  const heroProfile = buildHeroProfile(body);
  const heroPrompt = buildHeroMJPrompt(heroProfile, brandName);
  const productPrompt = buildProductPrompt(body);

  // Запускаем параллельно: MJ для героя + Recraft для продукта
  const [heroResult, productResult] = await Promise.allSettled([
    piApiKey
      ? submitMidjourney(heroPrompt, piApiKey).then((id) => pollMidjourney(id, piApiKey))
      : Promise.reject(new Error("PIAPI_KEY не задан")),
    falKey
      ? submitRecraft(productPrompt, falKey).then((id) => pollRecraft(id, falKey))
      : Promise.reject(new Error("FAL_API_KEY не задан")),
  ]);

  const hero = heroResult.status === "fulfilled" ? heroResult.value : null;
  const heroError = heroResult.status === "rejected" ? (heroResult.reason as Error).message : null;
  const product = productResult.status === "fulfilled" ? productResult.value : null;
  const productError = productResult.status === "rejected" ? (productResult.reason as Error).message : null;

  if (!hero && !product) {
    return NextResponse.json({
      error: "Оба генератора не отработали",
      heroError,
      productError,
    }, { status: 502 });
  }

  return NextResponse.json({
    // Герой: 4 варианта MJ, первый идёт в @Image1 автоматически
    heroVariants: hero ?? [],
    heroUrl: hero?.[0] ?? null,
    // Продукт: Recraft V3
    productUrl: product ?? null,
    // Профиль героя для прозрачности
    heroProfile: {
      gender: heroProfile.gender,
      age: heroProfile.age,
      style: `${heroProfile.look.slice(0, 80)}...`,
    },
    heroPrompt,
    productPrompt,
    errors: { hero: heroError, product: productError },
  });
}
