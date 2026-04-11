import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/user-keys";
import { sanitizePromptForNSFW, isNSFWBlock, buildNSFWFallbackPrompt, NSFW_FALLBACK_CHAIN } from "@/lib/nsfw-guard";
import { guardBrandImages, guardAtlasPayload } from "@/lib/pipeline-guard";
import { registry } from "@/lib/model-registry";
import { captureError } from "@/lib/sentry-capture";
import { proxiedFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 180;

// ─── Модели приоритет качества → цена → доступность ───────────────────────────
// 1. Seedance 2.0   Atlas Cloud  $0.022/сек — модель Егора, лучший результат
// 2. Seedance 1.5   fal.ai       $0.052/сек — fallback если Atlas недоступен
// 3. Kling Pro v2.1 fal.ai       $0.058/сек — хорошее качество
// 4. Kling Standard fal.ai       $0.029/сек — быстрее, чуть хуже
// 5. Hailuo MiniMax fal.ai       ~$0.04/сек — китайский конкурент
// 6. Wan 2.1        fal.ai       ~$0.01/сек — open source, last resort
// 7. Runway Gen-4   Runway API   fallback после fal.ai chain
// 8. OpenAI Sora    OpenAI API   fallback после Runway
// 9. Google Veo 3   AI Studio    last resort

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";
const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const SORA_BASE = "https://api.openai.com/v1";
const VEO3_BASE = "https://generativelanguage.googleapis.com/v1beta";

const FAL_MODELS = {
  "seedance-15":  "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
  "kling-pro":    "fal-ai/kling-video/v2.1/pro/image-to-video",
  "kling":        "fal-ai/kling-video/v2.1/standard/image-to-video",
  "hailuo":       "fal-ai/minimax/video-01-live/image-to-video",
  "wan":          "fal-ai/wan/v2.1/1.3b/image-to-video",
} as const;

type FalModel = keyof typeof FAL_MODELS;

const FAL_FALLBACK: Record<string, string | null> = {
  "seedance-15": "kling-pro",
  "kling-pro":   "kling",
  "kling":       "hailuo",
  "hailuo":      "wan",
  "wan":         null,
};

type VideoInput = {
  script: Array<{
    sceneNumber: number;
    visualPrompt: string;
    description: string;
    cameraMovement: string;
    duration: string;
  }>;
  keyframes: string[];
  mood: string;
  brandName?: string;
  aspectRatio?: string;   // "9:16" | "16:9", по умолчанию "9:16"
  brandImages?: string[]; // [0]=герой/продукт, [1]=лого, [2]=доп.ракурс, [3]=модель, [4]=товар, [5]=партнёр
  model?: string;
  forceProvider?: "fal";  // принудительно использовать fal.ai, пропустить Atlas
  variantsCount?: number; // 1-3 варианта на сцену (default: 1)
  videoReferenceUrl?: string; // URL видео-референса для Seedance 2.0
};

type AtlasDownError = Error & {
  atlasDown: true;
  reason: "timeout" | "http_error" | "all_retries_failed";
  httpStatus: number | null;
  estimatedWaitMinutes: number;
  fallbackAvailable: boolean;
  fallbackModel: string;
};

// Нормализуем @Image теги (LLM иногда пишет @image1 или @Image 1)
function normalizeImageTags(text: string): string {
  return text.replace(/@\s*[Ii]mage\s*([1-6])/g, "@Image$1");
}

// Строим промт: только маркеры @Image в начале, без описательных суффиксов.
// По курсу Егора: Seedance маппит @ImageN на N-й загруженный файл по порядку появления тега.
// Описания "is the main subject" не нужны — добавляют шум, не помогают маппингу.
function buildPrompt(visualPrompt: string, brandImages: string[]): string {
  // 1. Нормализуем теги написанные LLM
  const normalized = normalizeImageTags(visualPrompt.trim());

  // 2. Sanitize NSFW-триггеров (до Atlas отправки)
  const { prompt: sanitized, changed, replacements } = sanitizePromptForNSFW(normalized);
  if (changed) {
    console.log("[buildPrompt] NSFW sanitize applied:", replacements);
  }

  // 3. Если сценарист уже вставил @Image теги — промт готов
  if (sanitized.includes("@Image")) return sanitized;

  // 4. Если тегов нет — добавляем только маркеры в начало (без описаний ролей)
  if (brandImages.length === 0) return sanitized;
  const markers = brandImages
    .filter(Boolean)
    .map((_, i) => `@Image${i + 1}`)
    .join(" ");
  return `${markers} ${sanitized}`;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "video", 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: VideoInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const atlasKey = await resolveApiKey("atlas", process.env.ATLAS_CLOUD_API_KEY);
  const falKey = await resolveApiKey("fal", process.env.FAL_API_KEY);
  const runwayKey = await resolveApiKey("runway", process.env.RUNWAY_API_KEY);
  const openaiKey = await resolveApiKey("openai", process.env.OPENAI_API_KEY);
  const googleKey = await resolveApiKey("google", process.env.GOOGLE_AI_KEY);

  if (!atlasKey && !falKey && !runwayKey && !openaiKey && !googleKey) {
    return NextResponse.json({ error: "Нет ни ATLAS_CLOUD_API_KEY, ни FAL_API_KEY, ни других ключей провайдеров" }, { status: 500 });
  }

  const aspectRatio = body.aspectRatio ?? "9:16";
  // guardBrandImages: чистим пустые строки и невалидные URL до отправки в Atlas
  const { images: brandImages, repairs: imgRepairs, warnings: imgWarnings } = guardBrandImages(body.brandImages ?? []);
  if (imgRepairs.length > 0) console.log("[video] brandImages repairs:", imgRepairs);
  if (imgWarnings.length > 0) console.warn("[video] brandImages warnings:", imgWarnings);
  const hasFal = !!(falKey && falKey.length > 0);
  // forceProvider: "fal" → пропускаем Atlas, сразу fal.ai
  const useAtlas = !!atlasKey && body.forceProvider !== "fal";

  console.log(`[video] provider=${useAtlas ? "atlas" : "fal"}, scenes=${body.script.length}, ar=${aspectRatio}`);

  // ─── Сабмит через Atlas Cloud (Seedance 2.0) ────────────────────────────────
  // Retry 3 попытки — норма по курсу Егора (2-3 попытки дают лучший результат).
  // При 5xx или отсутствии prediction ID — ждём и повторяем, не переключаемся на другую модель.
  function makeAtlasDownError(
    reason: AtlasDownError["reason"],
    httpStatus: number | null,
    message: string
  ): AtlasDownError {
    const err = Object.assign(new Error(message), {
      atlasDown: true as const,
      reason,
      httpStatus,
      estimatedWaitMinutes: 2,
      fallbackAvailable: hasFal,
      fallbackModel: "Kling Pro (fal.ai)",
    });
    return err;
  }

  async function submitAtlas(
    prompt: string, imageUrls: string[], duration: string, sceneNumber: number, index: number,
    videoReferenceUrl?: string
  ) {
    const MAX_ATLAS_RETRIES = 3;
    let lastError: Error | null = null;
    let lastHttpStatus: number | null = null;

    for (let attempt = 1; attempt <= MAX_ATLAS_RETRIES; attempt++) {
      console.log(`[video] scene ${sceneNumber} → Atlas Seedance 2.0 (attempt ${attempt}/${MAX_ATLAS_RETRIES})`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${atlasKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `scene-${sceneNumber}-${Date.now()}`,
          },
          body: JSON.stringify({
            model: "bytedance/seedance-2.0/image-to-video",
            prompt,
            // image_urls = массив @Image1-@Image6 (бренд-референсы, одинаковые для всех сцен)
            // По Егору: @Image1=герой, @Image2=продукт спереди, @Image3=сзади, @Image4=лого
            ...(imageUrls.length > 0 && { image_urls: imageUrls }),
            ...(videoReferenceUrl && { reference_video_url: videoReferenceUrl }),
            ...(videoReferenceUrl && { video_reference_url: videoReferenceUrl }),
            duration: parseInt(duration) || 5,
            aspect_ratio: aspectRatio,
            quality: "pro",
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        clearTimeout(timer);
        const isTimeout =
          fetchErr instanceof Error &&
          (fetchErr.name === "AbortError" || fetchErr.name === "TimeoutError");
        console.warn(`[video] Atlas scene ${sceneNumber} attempt ${attempt} fetch error:`, fetchErr);
        if (isTimeout) {
          lastError = makeAtlasDownError("timeout", null, `Atlas: request timeout on scene ${sceneNumber}`);
        } else {
          lastError = makeAtlasDownError("http_error", null, `Atlas: network error on scene ${sceneNumber}`);
        }
        if (attempt < MAX_ATLAS_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw makeAtlasDownError("all_retries_failed", null, `Atlas: all ${MAX_ATLAS_RETRIES} attempts failed for scene ${sceneNumber}`);
      }
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        let errData: Record<string, string> = {};
        try { errData = JSON.parse(errText); } catch { errData = { error: errText }; }

        // NSFW блокировка — обычный retry не поможет, нужен другой промт
        if (isNSFWBlock(errData)) {
          registry.recordError("atlas-seedance-2", `NSFW block scene ${sceneNumber}`, true);
          console.warn(`[video] Atlas NSFW block on scene ${sceneNumber}, attempt ${attempt}`);
          if (attempt < MAX_ATLAS_RETRIES) {
            // На следующей попытке используем упрощённый промт
            prompt = buildNSFWFallbackPrompt(prompt);
            console.log(`[video] NSFW fallback prompt: "${prompt.slice(0, 80)}..."`);
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          // Все попытки исчерпаны — бросаем специальную ошибку для fal fallback
          throw Object.assign(new Error(`NSFW_BLOCKED: Atlas blocked scene ${sceneNumber}`), { nsfwBlocked: true });
        }

        lastHttpStatus = res.status;
        registry.recordError("atlas-seedance-2", `HTTP ${res.status} scene ${sceneNumber}`);
        lastError = makeAtlasDownError("http_error", res.status, `Atlas submit failed (${res.status}): ${errText.slice(0, 200)}`);
        console.warn(`[video] Atlas scene ${sceneNumber} attempt ${attempt} failed: HTTP ${res.status}`);
        if (attempt < MAX_ATLAS_RETRIES) await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      const data = await res.json();
      const predId = data?.data?.id as string;
      if (!predId) {
        registry.recordError("atlas-seedance-2", `no pred_id scene ${sceneNumber}`);
        lastError = makeAtlasDownError("http_error", res.status, "Atlas: no prediction ID in response");
        console.warn(`[video] Atlas scene ${sceneNumber} attempt ${attempt}: no pred_id`);
        if (attempt < MAX_ATLAS_RETRIES) await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      registry.recordSuccess("atlas-seedance-2");
      const pollingUrl = `${ATLAS_BASE}/model/prediction/${predId}`;
      console.log(`[video] Atlas scene ${sceneNumber}, pred_id: ${predId} (attempt ${attempt})`);

      return {
        index,
        sceneNumber,
        request_id: predId,
        status_url: pollingUrl,
        response_url: pollingUrl,
      };
    }

    throw lastError ?? makeAtlasDownError("all_retries_failed", lastHttpStatus, `Atlas: all ${MAX_ATLAS_RETRIES} attempts failed for scene ${sceneNumber}`);
  }

  // ─── Сабмит через fal.ai ────────────────────────────────────────────────────
  async function submitFal(
    prompt: string, imageUrl: string, duration: string, sceneNumber: number, index: number,
    startModel: FalModel = "seedance-15"
  ) {
    let currentModel: FalModel = startModel;
    let res: Response | null = null;
    let attempts = 0;
    const MAX_FAL_ATTEMPTS = Object.keys(FAL_FALLBACK).length + 1;

    while (currentModel && attempts < MAX_FAL_ATTEMPTS) {
      attempts++;
      const modelUrl = `https://queue.fal.run/${FAL_MODELS[currentModel]}`;
      console.log(`[video] scene ${sceneNumber}, trying fal model=${currentModel}`);

      // BUG-010 / BUG-019: AbortSignal.timeout для каждого fal fetch
      res = await fetch(modelUrl, {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey ?? ""}`,
          "Content-Type": "application/json",
          "X-Fal-Request-Id": `${sceneNumber}-${Date.now()}`,
        },
        body: JSON.stringify({
          prompt,
          image_url: imageUrl,
          duration,
          aspect_ratio: aspectRatio,
          cfg_scale: 0.5,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        registry.recordSuccess(`fal-${currentModel}` as Parameters<typeof registry.recordSuccess>[0]);
        break;
      }

      const falModelName = `fal-${currentModel}` as Parameters<typeof registry.recordError>[0];
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "300");
        registry.recordRateLimit(falModelName, retryAfter);
      } else {
        registry.recordError(falModelName, `HTTP ${res.status}`);
      }
      const next = FAL_FALLBACK[currentModel] ?? null;
      console.warn(`[video] ${currentModel} failed (${res.status}), next=${next ?? "none"}`);
      if (!next) break;
      currentModel = next as FalModel;
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text() : "no response";
      throw new Error(`fal.ai submit failed: ${errText}`);
    }

    const data = await res.json();
    console.log(`[video] fal scene ${sceneNumber}, request_id: ${data.request_id}`);
    return {
      index,
      sceneNumber,
      request_id: data.request_id as string,
      status_url: data.status_url as string,
      response_url: data.response_url as string,
    };
  }

  // ─── Runway Gen-4 ───────────────────────────────────────────────────────────
  async function submitRunway(
    prompt: string, imageUrl: string, duration: string, sceneNumber: number, index: number
  ) {
    console.log(`[video] scene ${sceneNumber} → Runway Gen-4`);
    const submitRes = await proxiedFetch(`${RUNWAY_BASE}/image_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runwayKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model: "gen4_turbo",
        promptImage: imageUrl,
        promptText: prompt,
        ratio: aspectRatio === "9:16" ? "720:1280" : "1280:720",
        duration: Math.min(parseInt(duration) || 5, 10),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Runway submit failed (${submitRes.status}): ${errText.slice(0, 200)}`);
    }

    const submitData = await submitRes.json() as { id: string };
    const taskId = submitData.id;
    if (!taskId) throw new Error("Runway: no task ID in response");

    console.log(`[video] Runway scene ${sceneNumber}, taskId: ${taskId}`);

    // Polling loop — max 120 сек, интервал 5 сек
    const MAX_RUNWAY_POLL_MS = 120_000;
    const RUNWAY_INTERVAL_MS = 5_000;
    const deadline = Date.now() + MAX_RUNWAY_POLL_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RUNWAY_INTERVAL_MS));

      const pollRes = await proxiedFetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
        signal: AbortSignal.timeout(15_000),
      });

      if (!pollRes.ok) {
        console.warn(`[video] Runway poll failed (${pollRes.status}) for task ${taskId}`);
        continue;
      }

      const pollData = await pollRes.json() as {
        status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
        output?: string[];
        failure?: string;
      };

      if (pollData.status === "SUCCEEDED") {
        const videoUrl = pollData.output?.[0];
        if (!videoUrl) throw new Error("Runway: SUCCEEDED but no output URL");
        console.log(`[video] Runway scene ${sceneNumber} done: ${videoUrl}`);
        return {
          index,
          sceneNumber,
          request_id: taskId,
          status_url: `${RUNWAY_BASE}/tasks/${taskId}`,
          response_url: videoUrl,
          provider: "runway",
        };
      }

      if (pollData.status === "FAILED") {
        throw new Error(`Runway task FAILED: ${pollData.failure ?? "unknown reason"}`);
      }

      console.log(`[video] Runway scene ${sceneNumber} status: ${pollData.status}`);
    }

    throw new Error(`Runway polling timeout for scene ${sceneNumber}`);
  }

  // ─── OpenAI Sora ─────────────────────────────────────────────────────────────
  async function submitSora(
    prompt: string, sceneNumber: number, index: number
  ) {
    console.log(`[video] scene ${sceneNumber} → OpenAI Sora`);
    const submitRes = await proxiedFetch(`${SORA_BASE}/video/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sora-1-0-mini-2025-05-19",
        prompt,
        size: aspectRatio === "9:16" ? "480x854" : "854x480",
        n: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Sora submit failed (${submitRes.status}): ${errText.slice(0, 200)}`);
    }

    const submitData = await submitRes.json() as {
      data?: Array<{ url?: string }>;
      id?: string;
    };

    // Синхронный ответ (mini модель)
    const directUrl = submitData.data?.[0]?.url;
    if (directUrl) {
      console.log(`[video] Sora scene ${sceneNumber} sync done: ${directUrl}`);
      return {
        index,
        sceneNumber,
        request_id: `sora-sync-${sceneNumber}`,
        status_url: directUrl,
        response_url: directUrl,
        provider: "sora",
      };
    }

    // Асинхронный ответ — polling
    const genId = submitData.id;
    if (!genId) throw new Error("Sora: no generation ID in response");

    console.log(`[video] Sora scene ${sceneNumber}, genId: ${genId}`);

    const MAX_SORA_POLL_MS = 120_000;
    const SORA_INTERVAL_MS = 5_000;
    const deadline = Date.now() + MAX_SORA_POLL_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SORA_INTERVAL_MS));

      const pollRes = await proxiedFetch(`${SORA_BASE}/video/generations/${genId}`, {
        headers: { Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!pollRes.ok) {
        console.warn(`[video] Sora poll failed (${pollRes.status}) for gen ${genId}`);
        continue;
      }

      const pollData = await pollRes.json() as {
        status?: string;
        data?: Array<{ url?: string }>;
      };

      const pollUrl = pollData.data?.[0]?.url;
      if (pollUrl) {
        console.log(`[video] Sora scene ${sceneNumber} async done: ${pollUrl}`);
        return {
          index,
          sceneNumber,
          request_id: genId,
          status_url: `${SORA_BASE}/video/generations/${genId}`,
          response_url: pollUrl,
          provider: "sora",
        };
      }

      if (pollData.status === "failed") {
        throw new Error(`Sora generation failed for scene ${sceneNumber}`);
      }

      console.log(`[video] Sora scene ${sceneNumber} status: ${pollData.status ?? "unknown"}`);
    }

    throw new Error(`Sora polling timeout for scene ${sceneNumber}`);
  }

  // ─── Google Veo 3 ────────────────────────────────────────────────────────────
  async function submitVeo3(
    prompt: string, imageUrl: string, duration: string, sceneNumber: number, index: number
  ) {
    console.log(`[video] scene ${sceneNumber} → Google Veo 3`);
    const submitRes = await proxiedFetch(
      `${VEO3_BASE}/models/veo-3.0-generate-preview:generateVideos?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt, image: { url: imageUrl } }],
          parameters: {
            aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9",
            durationSeconds: Math.min(parseInt(duration) || 5, 8),
            sampleCount: 1,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Veo3 submit failed (${submitRes.status}): ${errText.slice(0, 200)}`);
    }

    const submitData = await submitRes.json() as { name?: string };
    const operationName = submitData.name;
    if (!operationName) throw new Error("Veo3: no operation name in response");

    console.log(`[video] Veo3 scene ${sceneNumber}, operation: ${operationName}`);

    const MAX_VEO3_POLL_MS = 120_000;
    const VEO3_INTERVAL_MS = 5_000;
    const deadline = Date.now() + MAX_VEO3_POLL_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, VEO3_INTERVAL_MS));

      const pollRes = await proxiedFetch(
        `${VEO3_BASE}/${operationName}?key=${googleKey}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!pollRes.ok) {
        console.warn(`[video] Veo3 poll failed (${pollRes.status}) for operation ${operationName}`);
        continue;
      }

      const pollData = await pollRes.json() as {
        done?: boolean;
        error?: { message?: string };
        response?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
      };

      if (pollData.error) {
        throw new Error(`Veo3 operation error: ${pollData.error.message ?? "unknown"}`);
      }

      if (pollData.done) {
        const videoUri = pollData.response?.generatedSamples?.[0]?.video?.uri;
        if (!videoUri) throw new Error("Veo3: done but no video URI");
        console.log(`[video] Veo3 scene ${sceneNumber} done: ${videoUri}`);
        return {
          index,
          sceneNumber,
          request_id: operationName,
          status_url: `${VEO3_BASE}/${operationName}?key=${googleKey}`,
          response_url: videoUri,
          provider: "veo3",
        };
      }

      console.log(`[video] Veo3 scene ${sceneNumber} still running...`);
    }

    throw new Error(`Veo3 polling timeout for scene ${sceneNumber}`);
  }

  // ─── Основная функция отправки сцены ────────────────────────────────────────
  async function submitScene(scene: VideoInput["script"][number], i: number) {
    const keyframeUrl = body.keyframes[i];
    if (!keyframeUrl && !brandImages[0]) {
      throw new Error(`Не найден кадр для сцены ${scene.sceneNumber}`);
    }
    const rawImageUrl = (i === 0 && brandImages[0]) ? brandImages[0] : keyframeUrl;
    const durationNum = parseInt(scene.duration) || 5;
    const durationFal = durationNum >= 10 ? "10" : "5";
    const prompt = buildPrompt(scene.visualPrompt, brandImages);

    // guardAtlasPayload: fix missing image_url, clamp duration к допустимым значениям Atlas
    const { payload: atlasPayload, repairs: atlasRepairs, errors: atlasErrors } = guardAtlasPayload({
      prompt,
      image_url: rawImageUrl,
      duration: durationNum,
      useAtlas,
      is15single: body.aspectRatio === "9:16" && durationNum === 15,
      brandImages,
    });
    if (atlasRepairs.length > 0) console.log(`[video] guardAtlas scene ${scene.sceneNumber} repairs:`, atlasRepairs);
    if (atlasErrors.length > 0) console.warn(`[video] guardAtlas scene ${scene.sceneNumber} errors:`, atlasErrors);

    const imageUrl = atlasPayload.image_url;
    // Seedance 2.0 (Atlas): поддерживает 5, 8, 10, 15 сек
    const durationAtlas = String(atlasPayload.duration);

    // Пробуем Atlas Cloud первым, fallback на fal.ai
    // По workflow Егора: brandImages = [@Image1=герой, @Image2=продукт спереди, @Image3=сзади,
    // @Image4=лого, @Image5=товар, @Image6=партнёр] — одинаковые для ВСЕХ сцен.
    // Keyframe (Midjourney) идёт как image_url (starting frame) — отдельно от image_urls.
    if (useAtlas) {
      const atlasImageUrls = brandImages.filter(Boolean).slice(0, 6);
      try {
        return await submitAtlas(prompt, atlasImageUrls, durationAtlas, scene.sceneNumber, i, body.videoReferenceUrl);
      } catch (e: unknown) {
        const err = e as Error & { nsfwBlocked?: boolean; atlasDown?: boolean };
        if (err.nsfwBlocked && hasFal) {
          // NSFW заблокировал Atlas — пробуем fal.ai с цепочкой NSFW_FALLBACK_CHAIN
          console.warn(`[video] Atlas NSFW → fal.ai NSFW fallback chain for scene ${scene.sceneNumber}`);
          const fallbackPrompt = buildNSFWFallbackPrompt(prompt);
          // Пробуем каждую модель из NSFW chain по порядку
          for (const model of NSFW_FALLBACK_CHAIN) {
            const falModel = model as FalModel;
            if (!FAL_MODELS[falModel]) continue;
            try {
              return await submitFal(fallbackPrompt, imageUrl, durationFal, scene.sceneNumber, i, falModel);
            } catch {
              console.warn(`[video] NSFW fallback ${model} also failed`);
            }
          }
        }
        // Atlas недоступен (atlasDown) — пробрасываем ошибку наверх без fal fallback,
        // чтобы пользователь мог выбрать: повторить позже или использовать fal.ai явно.
        if (err.atlasDown) {
          console.warn(`[video] Atlas down on scene ${scene.sceneNumber}, propagating atlasDown error`);
          throw e;
        }
        console.warn(`[video] Atlas failed for scene ${scene.sceneNumber}, falling back to fal.ai:`, err.message);
        const hasAnyFallback = hasFal || !!runwayKey || !!openaiKey || !!googleKey;
        if (!hasAnyFallback) throw e;
      }
    }

    // Попытка fal.ai chain
    let falError: Error | null = null;
    try {
      return await submitFal(prompt, imageUrl, durationFal, scene.sceneNumber, i);
    } catch (e: unknown) {
      falError = e as Error;
      console.warn(`[video] fal.ai failed for scene ${scene.sceneNumber}:`, falError.message);
    }

    // Runway Gen-4
    if (runwayKey) {
      try {
        return await submitRunway(prompt, imageUrl, durationFal, scene.sceneNumber, i);
      } catch (e: unknown) {
        console.warn("[video] Runway failed:", (e as Error).message);
      }
    }

    // OpenAI Sora (не принимает imageUrl в mini — только промт)
    if (openaiKey) {
      try {
        return await submitSora(prompt, scene.sceneNumber, i);
      } catch (e: unknown) {
        console.warn("[video] Sora failed:", (e as Error).message);
      }
    }

    // Google Veo 3
    if (googleKey) {
      try {
        return await submitVeo3(prompt, imageUrl, durationFal, scene.sceneNumber, i);
      } catch (e: unknown) {
        console.warn("[video] Veo3 failed:", (e as Error).message);
      }
    }

    throw falError ?? new Error("All providers failed");
  }

  const variantsCount = Math.min(Math.max(1, body.variantsCount ?? 1), 3);

  // Батчинг по 3 чтобы не превысить rate limit.
  // При variantsCount > 1 каждая сцена порождает N параллельных запросов (разные индексы варианта).
  const BATCH_SIZE = 3;

  // Плоский список задач: { scene, sceneArrayIndex, variantIndex }
  type SubmitTask = { scene: VideoInput["script"][number]; sceneArrayIndex: number; variantIndex: number };
  const tasks: SubmitTask[] = [];
  for (let si = 0; si < body.script.length; si++) {
    for (let vi = 0; vi < variantsCount; vi++) {
      tasks.push({ scene: body.script[si], sceneArrayIndex: si, variantIndex: vi });
    }
  }

  type SubmitResult = Awaited<ReturnType<typeof submitScene>> & { variantIndex: number };

  const allResults: PromiseSettledResult<SubmitResult>[] = [];
  for (let b = 0; b < tasks.length; b += BATCH_SIZE) {
    const batch = tasks.slice(b, b + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (t) => {
        const base = await submitScene(t.scene, t.sceneArrayIndex);
        return { ...base, variantIndex: t.variantIndex } as SubmitResult;
      })
    );
    allResults.push(...batchResults);
    if (b + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Собираем плоский список сцен (обратная совместимость: variantIndex в объекте)
  const scenes = allResults.map((r, i) => {
    const task = tasks[i];
    return r.status === "fulfilled"
      ? r.value
      : {
          index: task.sceneArrayIndex,
          sceneNumber: task.scene.sceneNumber,
          variantIndex: task.variantIndex,
          error: (r as PromiseRejectedResult).reason?.message ?? "submit failed",
        };
  });

  const succeeded = scenes.filter((s) => "request_id" in s);
  if (succeeded.length === 0) {
    const errors = scenes.map((s) => ("error" in s ? s.error : "")).filter(Boolean);
    captureError(new Error("All scenes failed"), { provider: useAtlas ? "atlas" : "fal", errors });

    // Проверяем: все ли ошибки — от Atlas (atlasDown). Если да — возвращаем структурированную ошибку.
    const failedReasons = allResults
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason as AtlasDownError);
    const allAtlasDown = failedReasons.length > 0 && failedReasons.every((e) => e?.atlasDown === true);

    if (allAtlasDown) {
      const sample = failedReasons[0];
      return NextResponse.json(
        {
          error: "Atlas Cloud недоступен",
          atlasDown: true,
          reason: sample.reason,
          httpStatus: sample.httpStatus,
          estimatedWaitMinutes: sample.estimatedWaitMinutes,
          fallbackAvailable: hasFal,
          fallbackModel: "Kling Pro (fal.ai)",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ error: "Все сцены не удалось отправить на генерацию" }, { status: 502 });
  }

  const provider = useAtlas ? "seedance-2.0" : "seedance-1.5";
  return NextResponse.json({ scenes, variantsCount, model: provider });
}
