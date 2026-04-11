import { NextRequest } from "next/server";
import { optimizePrompts } from "@/lib/prompt-engineer";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/user-keys";

export const runtime = "nodejs";
export const maxDuration = 180;

// Стек качества кадров (в порядке убывания):
// Hero/модель → Midjourney v7 (piapi.ai) — лучшее лицо (~$0.04/кадр)
// Продукт/лого → Recraft V3 (fal.ai)    — лучшая коммерческая фотография ($0.04/кадр)
// Fallback 1   → fal.ai Flux Pro         — отличное ($0.055/кадр)
// Fallback 2   → fal.ai Flux Dev         — хорошее ($0.025/кадр)
// Fallback 3   → HuggingFace Flux        — бесплатно, last resort

const PIAPI_IMAGINE_URL = "https://api.piapi.ai/mj/v2/imagine";
const PIAPI_FETCH_URL   = "https://api.piapi.ai/mj/v2/fetch";
const FAL_RECRAFT_V3    = "https://queue.fal.run/fal-ai/recraft-v3";
const FAL_FLUX_PRO      = "https://queue.fal.run/fal-ai/flux-pro";
const FAL_FLUX_DEV      = "https://queue.fal.run/fal-ai/flux/dev";
const HF_API_URL        = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";

// Классификатор сцены: hero (лицо/модель) vs product (товар/лого/деталь)
// Используем ключевые слова из description + visualPrompt
function classifyScene(description: string, visualPrompt: string): "hero" | "product" {
  // Primary: visualPrompt всегда английский — самый надёжный сигнал
  const vpLower = visualPrompt.toLowerCase();
  const descLower = (description ?? "").toLowerCase();

  // Product keywords (EN + RU)
  const productKw = [
    "product", "bottle", "package", "logo", "label", "jar", "box", "packaging",
    "macro", "close-up", "closeup", "flat lay", "still life", "object",
    "продукт", "флакон", "упаковка", "лого", "логотип", "банка", "коробка",
    "макро", "крупный план", "натюрморт", "предмет"
  ];

  // Hero keywords (EN + RU)
  const heroKw = [
    "woman", "man", "model", "person", "face", "portrait", "hands", "body",
    "girl", "boy", "human", "people", "hand", "fingers",
    "женщина", "мужчина", "модель", "человек", "лицо", "портрет", "руки",
    "девушка", "парень", "люди", "рука", "пальцы"
  ];

  // Score both categories in visualPrompt (primary) and description (secondary, half weight)
  let productScore = 0;
  let heroScore = 0;

  for (const kw of productKw) {
    if (vpLower.includes(kw)) productScore += 2;
    if (descLower.includes(kw)) productScore += 1;
  }
  for (const kw of heroKw) {
    if (vpLower.includes(kw)) heroScore += 2;
    if (descLower.includes(kw)) heroScore += 1;
  }

  // Если @Image1 (герой) упомянут в промте — это hero сцена
  if (vpLower.includes("@image1")) heroScore += 5;
  // Если @Image2/@Image3 (продукт) — product сцена
  if (vpLower.includes("@image2") || vpLower.includes("@image3")) productScore += 5;

  return productScore > heroScore ? "product" : "hero";
}

type FramesInput = {
  script: Array<{
    sceneNumber: number;
    visualPrompt: string;
    description: string;
    cameraMovement: string;
    duration: string;
  }>;
  brandName: string;
  mood: string;
  uploadedImages: string[];
  variantsPerScene?: 1 | 2 | 3;  // генерировать N вариантов на сцену
};

function fetchWithTimeout(url: string, options: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// Конвертируем video-промт в image-промт:
// - убираем @Image теги (Midjourney/Flux не понимают)
// - убираем инструкции движения камеры (для видео, не для фото)
// - добавляем image-quality суффикс для Flux
function buildImagePrompt(visualPrompt: string, forFlux: boolean): string {
  const cleaned = visualPrompt
    .replace(/@Image\d+(\s+is\s+the[\w\s]+)?/gi, "")
    .replace(/\b(slow push-in|push-in|tracking shot|slow orbit|dolly back|dolly-in|overhead shot|rack focus|static camera|camera (slow|starts|moves|pushes|pulls|tracks|orbits|begins))\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/([,;])\s*\1/g, "$1")
    .replace(/[,;]\s*$/, "")
    .trim();

  if (forFlux) {
    return `${cleaned}, professional commercial photography, sharp focus, high detail`;
  }
  return cleaned;
}

// Recraft V3 (fal.ai) — лучшая коммерческая продуктовая фотография (~$0.04/кадр)
// Специализирован на: продукты, лого, brand identity, упаковка
async function generateFrameRecraft(
  prompt: string,
  falKey: string
): Promise<ArrayBuffer | null> {
  try {
    const submitRes = await fetchWithTimeout(FAL_RECRAFT_V3, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${buildImagePrompt(prompt, false)}, professional commercial product photography, clean studio lighting, sharp focus, premium brand quality`,
        image_size: { width: 1024, height: 1820 }, // 9:16 вертикальный
        style: "realistic_image",
        n: 1,
      }),
    }, 30_000);

    if (!submitRes.ok) {
      console.warn(`[frames] Recraft V3 submit failed: ${submitRes.status}`);
      return null;
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id as string;
    const statusUrl = submitData.status_url as string;
    const responseUrl = submitData.response_url as string;

    if (!requestId) {
      // Синхронный ответ
      const imageUrl = submitData.images?.[0]?.url;
      if (imageUrl) {
        const imgRes = await fetchWithTimeout(imageUrl, {}, 30_000);
        return imgRes.ok ? imgRes.arrayBuffer() : null;
      }
      return null;
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 3_000));

      const statusRes = await fetchWithTimeout(statusUrl, {
        headers: { Authorization: `Key ${falKey}` },
      }, 15_000);

      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();

      if (statusData.status === "COMPLETED") {
        const resultRes = await fetchWithTimeout(responseUrl, {
          headers: { Authorization: `Key ${falKey}` },
        }, 15_000);
        if (!resultRes.ok) return null;
        const result = await resultRes.json();
        const imageUrl = result.images?.[0]?.url;
        if (!imageUrl) return null;
        const imgRes = await fetchWithTimeout(imageUrl, {}, 30_000);
        return imgRes.ok ? imgRes.arrayBuffer() : null;
      }

      if (statusData.status === "FAILED") {
        console.warn(`[frames] Recraft V3 job failed`);
        return null;
      }
    }

    console.warn(`[frames] Recraft V3 timeout`);
    return null;
  } catch (e) {
    console.warn(`[frames] Recraft V3 error:`, e);
    return null;
  }
}

// Midjourney v7 через piapi.ai — абсолютно лучшее качество кадров
// Регистрация: https://piapi.ai · ~$0.04/кадр
async function generateFrameMidjourney(
  prompt: string,
  piApiKey: string
): Promise<ArrayBuffer | null> {
  try {
    // 1. Submit задачу
    const submitRes = await fetchWithTimeout(PIAPI_IMAGINE_URL, {
      method: "POST",
      headers: {
        "x-api-key": piApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${prompt} --ar 9:16 --v 7 --style raw --q 2`,
        process_mode: "fast",
      }),
    }, 30_000);

    if (!submitRes.ok) {
      console.warn(`[frames] piapi.ai submit failed: ${submitRes.status}`);
      return null;
    }

    const submitData = await submitRes.json();
    const taskId: string = submitData.task_id;
    if (!taskId) return null;

    // 2. Poll пока не finished (обычно 30-90 сек)
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 4_000));

      const fetchRes = await fetchWithTimeout(PIAPI_FETCH_URL, {
        method: "POST",
        headers: {
          "x-api-key": piApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ task_id: taskId }),
      }, 15_000);

      if (!fetchRes.ok) continue;
      const fetchData = await fetchRes.json();

      if (fetchData.status === "finished") {
        // Берём первый из 4 вариантов (лучший по умолчанию)
        const imageUrl: string = fetchData.task_result?.image_urls?.[0] ?? fetchData.task_result?.image_url;
        if (!imageUrl) return null;
        const imgRes = await fetchWithTimeout(imageUrl, {}, 30_000);
        return imgRes.ok ? imgRes.arrayBuffer() : null;
      }

      if (fetchData.status === "failed") {
        console.warn(`[frames] Midjourney task failed`);
        return null;
      }
    }

    console.warn(`[frames] Midjourney timeout`);
    return null;
  } catch (e) {
    console.warn(`[frames] Midjourney error:`, e);
    return null;
  }
}

// fal.ai Flux: submit → poll → get image URL
async function generateFrameFal(
  prompt: string,
  falKey: string,
  useFluxPro: boolean
): Promise<ArrayBuffer | null> {
  const endpoint = useFluxPro ? FAL_FLUX_PRO : FAL_FLUX_DEV;

  try {
    // Submit
    const submitRes = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_size: { width: 576, height: 1024 },  // 9:16 для вертикального видео
        num_images: 1,
        num_inference_steps: useFluxPro ? 28 : 20,
        guidance_scale: 3.5,
        enable_safety_checker: false,
      }),
    }, 30_000);

    if (!submitRes.ok) {
      console.warn(`[frames] fal.ai ${useFluxPro ? "pro" : "dev"} submit failed: ${submitRes.status}`);
      return null;
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id as string;
    const statusUrl = submitData.status_url as string;
    const responseUrl = submitData.response_url as string;

    if (!requestId) {
      // Синхронный ответ — fal.ai иногда сразу возвращает результат
      const imageUrl = submitData.images?.[0]?.url;
      if (imageUrl) {
        const imgRes = await fetchWithTimeout(imageUrl, {}, 30_000);
        return imgRes.ok ? imgRes.arrayBuffer() : null;
      }
      return null;
    }

    // Poll пока не COMPLETED
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((r) => setTimeout(r, 3_000));

      const statusRes = await fetchWithTimeout(statusUrl, {
        headers: { Authorization: `Key ${falKey}` },
      }, 15_000);

      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();

      if (statusData.status === "COMPLETED") {
        // Получаем результат
        const resultRes = await fetchWithTimeout(responseUrl, {
          headers: { Authorization: `Key ${falKey}` },
        }, 15_000);
        if (!resultRes.ok) return null;
        const result = await resultRes.json();
        const imageUrl = result.images?.[0]?.url;
        if (!imageUrl) return null;
        const imgRes = await fetchWithTimeout(imageUrl, {}, 30_000);
        return imgRes.ok ? imgRes.arrayBuffer() : null;
      }

      if (statusData.status === "FAILED") {
        console.warn(`[frames] fal.ai job failed`);
        return null;
      }
    }

    console.warn(`[frames] fal.ai timeout after polling`);
    return null;
  } catch (e) {
    console.warn(`[frames] fal.ai error:`, e);
    return null;
  }
}

// HuggingFace Flux Schnell — бесплатный fallback
async function generateFrameHF(
  prompt: string,
  hfToken: string
): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(HF_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { width: 576, height: 1024, num_inference_steps: 4 },
        }),
      }, 60_000);

      if (res.ok) return res.arrayBuffer();

      if (res.status === 503 && attempt < 2) {
        console.log(`[frames] HF cold start, waiting 20s`);
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }

      console.error(`[frames] HF error: ${res.status}`);
      return null;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  return null;
}

// Quality Gate: Gemini 2.0 Flash оценивает кадр до загрузки (0-100)
// Критерии: отсутствие артефактов, резкость, коммерческая эстетика, экспозиция
// Вызываем на буфере чтобы не тратить деньги на загрузку плохих кадров
async function scoreFrameBuffer(
  buf: ArrayBuffer,
  geminiKey: string
): Promise<{ score: number; issues: string[] }> {
  try {
    const b64 = Buffer.from(buf).toString("base64");

    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: b64 } },
              { text: `Score this commercial video keyframe on a 0-100 scale for use in a premium brand advertisement.

Scoring criteria (25 points each):
1. No visual artifacts, distortions, or AI glitches
2. Sharp focus and clear composition
3. Professional commercial/editorial aesthetic
4. Correct exposure, colors, and lighting quality

Return ONLY valid JSON: {"score": <integer 0-100>, "issues": ["brief issue descriptions if any"]}
If the image is of excellent quality with no issues, return score 85-95.` }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 150,
            responseMimeType: "application/json",
          },
        }),
      },
      15_000
    );

    if (!res.ok) return { score: 75, issues: ["gemini unavailable"] };

    const data = await res.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as { score?: number; issues?: string[] };
    const score = Math.min(100, Math.max(0, parsed.score ?? 75));
    return { score, issues: parsed.issues ?? [] };
  } catch {
    // Если Gemini недоступен — не блокируем генерацию, даём 75 (проходной)
    return { score: 75, issues: ["quality check skipped"] };
  }
}

async function uploadFrame(buf: ArrayBuffer, key: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase storage not configured");
  }

  const sanitizedKey = key.replace(/\.\./g, "").replace(/[^a-zA-Z0-9/_.\-]/g, "").slice(0, 500);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(`${supabaseUrl}/storage/v1/object/videos/${sanitizedKey}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: buf,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(id));

      if (res.ok) {
        return `${supabaseUrl}/storage/v1/object/public/videos/${sanitizedKey}`;
      }
      console.error(`[frames] uploadFrame attempt ${attempt + 1} failed: ${res.status}`);
    } catch (e) {
      console.error(`[frames] uploadFrame attempt ${attempt + 1} error:`, e);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Upload failed for ${key}`);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "frames", 3);
  if (!rl.allowed) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Too many requests", retryAfter: rl.retryAfter })}\n\n`,
      { status: 429, headers: { "Content-Type": "text/event-stream", "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: FramesInput;
  try {
    body = await req.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Invalid JSON body" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }
  const piApiKey = await resolveApiKey("piapi", process.env.PIAPI_KEY);
  const falKey = await resolveApiKey("fal", process.env.FAL_API_KEY);
  const hfToken = await resolveApiKey("huggingface", process.env.HUGGINGFACE_TOKEN);

  const hasPiApi = !!piApiKey;
  const hasFal = !!falKey;
  const hasHF = !!hfToken;

  if (!hasPiApi && !hasFal && !hasHF) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Не настроен ни PIAPI_KEY, ни FAL_API_KEY, ни HUGGINGFACE_TOKEN" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const encoder = new TextEncoder();
  const BATCH = 3;

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const send = (data: object) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          streamClosed = true;
        }
      };

      try {
      const variantsPerScene = Math.max(1, Math.min(body.variantsPerScene ?? 1, 3));
      // hero scenes → MJ v7 (if piapi key set), product scenes → Recraft V3 (if fal key set)
      const mode = hasPiApi && hasFal ? "mj-hero+recraft-product" : hasPiApi ? "midjourney" : hasFal ? "recraft+flux" : "hf-flux";
      send({ type: "start", total: body.script.length, mode, variantsPerScene });
      console.log(`[frames] generating ${body.script.length} scenes × ${variantsPerScene} variants, mode=${mode}`);

      // Агент 3: Промт-инженер оптимизирует все промты под конкретную модель
      const targetModel = hasPiApi ? "midjourney" : "flux";
      send({ type: "optimizing_prompts", model: targetModel });
      const optimizedPrompts = await optimizePrompts(
        body.script.map(s => ({
          sceneNumber: s.sceneNumber,
          description: s.description ?? s.visualPrompt,
          visualPrompt: s.visualPrompt,
          cameraMovement: s.cameraMovement ?? "",
          duration: s.duration ?? "5 sec",
        })),
        targetModel,
        { brandName: body.brandName, mood: body.mood }
      );
      console.log(`[frames] prompts optimized for ${targetModel}`);

      // keyframeVariants[sceneIdx][variantIdx] = url
      const keyframeVariants: string[][] = body.script.map(() => []);
      // keyframes[sceneIdx] = first successful variant (selected by default)
      const keyframes: string[] = new Array(body.script.length).fill("");

      const geminiKey = (await resolveApiKey("gemini", process.env.GEMINI_API_KEY)) ?? "";
      const QUALITY_THRESHOLD = 80;
      const MAX_QUALITY_RETRIES = 2;

      async function generateRawBuffer(
        prompt: string,
        sceneType: "hero" | "product"
      ): Promise<ArrayBuffer | null> {
        let buf: ArrayBuffer | null = null;
        if (sceneType === "product" && hasFal) {
          buf = await generateFrameRecraft(prompt, falKey!);
          if (!buf) buf = await generateFrameFal(buildImagePrompt(prompt, true), falKey!, true);
        } else if (hasPiApi) {
          buf = await generateFrameMidjourney(prompt, piApiKey!);
        }
        if (!buf && hasFal) {
          buf = await generateFrameFal(buildImagePrompt(prompt, true), falKey!, true);
          if (!buf) buf = await generateFrameFal(buildImagePrompt(prompt, true), falKey!, false);
        }
        if (!buf && hasHF) {
          buf = await generateFrameHF(buildImagePrompt(prompt, true), hfToken!);
        }
        return buf;
      }

      async function generateOneVariant(
        prompt: string,
        sceneNumber: number,
        idx: number,
        variantIdx: number,
        sceneType: "hero" | "product"
      ): Promise<string | null> {
        const useQualityGate = !!geminiKey;
        let bestBuf: ArrayBuffer | null = null;
        let bestScore = 0;
        const attempts = useQualityGate ? MAX_QUALITY_RETRIES + 1 : 1;

        for (let attempt = 0; attempt < attempts; attempt++) {
          const buf = await generateRawBuffer(prompt, sceneType);
          if (!buf || buf.byteLength === 0) continue;

          if (!useQualityGate) {
            bestBuf = buf;
            break;
          }

          const { score, issues } = await scoreFrameBuffer(buf, geminiKey);
          console.log(`[frames] scene ${sceneNumber} v${variantIdx} attempt ${attempt + 1}: score=${score}${issues.length ? ` [${issues.slice(0, 2).join(",")}]` : ""}`);

          if (score > bestScore) { bestScore = score; bestBuf = buf; }
          if (score >= QUALITY_THRESHOLD) break;
          if (attempt < attempts - 1) {
            console.log(`[frames] score ${score} < ${QUALITY_THRESHOLD}, retrying...`);
          }
        }

        if (!bestBuf) return null;
        const key = `frames/${crypto.randomUUID()}-scene${sceneNumber}-v${variantIdx}.jpg`;
        return uploadFrame(bestBuf, key);
      }

      for (let b = 0; b < body.script.length; b += BATCH) {
        const batch = body.script.slice(b, b + BATCH);

        await Promise.all(
          batch.map(async (scene, j) => {
            const idx = b + j;
            const prompt = optimizedPrompts[idx];
            const sceneType = classifyScene(scene.description ?? "", scene.visualPrompt);
            send({ type: "generating", index: idx, sceneNumber: scene.sceneNumber, variants: variantsPerScene, sceneType });

            // Генерируем variantsPerScene вариантов параллельно
            const variantResults = await Promise.allSettled(
              Array.from({ length: variantsPerScene }, (_, vi) =>
                generateOneVariant(prompt, scene.sceneNumber, idx, vi, sceneType)
              )
            );

            const urls: string[] = [];
            for (const r of variantResults) {
              if (r.status === "fulfilled" && r.value) {
                urls.push(r.value);
              }
            }

            if (urls.length === 0) {
              send({ type: "frame_error", index: idx, sceneNumber: scene.sceneNumber });
              return;
            }

            keyframeVariants[idx] = urls;
            keyframes[idx] = urls[0]; // первый — по умолчанию выбранный
            send({ type: "frame_done", index: idx, sceneNumber: scene.sceneNumber, url: urls[0], variants: urls });
          })
        );

        if (b + BATCH < body.script.length) await new Promise((r) => setTimeout(r, 500));
      }

      const valid = keyframes.filter((u) => u.length > 0);
      send({ type: "done", keyframes, keyframeVariants, valid: valid.length });
      } catch (e) {
        send({ type: "frame_error", error: e instanceof Error ? e.message : "Unexpected error" });
      } finally {
        streamClosed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
