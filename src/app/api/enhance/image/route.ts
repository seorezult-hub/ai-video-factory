import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

// fal.ai endpoints
const FAL_REMBG = "https://queue.fal.run/fal-ai/imageutils/rembg";
const FAL_UPSCALE = "https://queue.fal.run/fal-ai/clarity-upscaler";
const FAL_POLL_BASE = "https://queue.fal.run/fal-ai";

type EnhanceType = "remove-bg" | "upscale" | "both";

type Input = {
  imageUrl: string;
  enhanceType: EnhanceType;
  slotType?: "hero" | "product" | "logo" | "detail" | "other";
};

const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0)/;

async function falSubmit(endpoint: string, payload: object, falKey: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fal submit failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.request_id as string;
}

async function falPoll(requestId: string, modelPath: string, falKey: string): Promise<Record<string, unknown>> {
  const statusUrl = `${FAL_POLL_BASE}/${modelPath}/requests/${requestId}/status`;
  const resultUrl = `${FAL_POLL_BASE}/${modelPath}/requests/${requestId}`;

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${falKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const { status } = await res.json();
    if (status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${falKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return await resultRes.json();
    }
    if (status === "FAILED") throw new Error("fal processing failed");
  }
  throw new Error("fal polling timeout (80s)");
}

async function removeBg(imageUrl: string, falKey: string): Promise<string> {
  const reqId = await falSubmit(FAL_REMBG, { image_url: imageUrl }, falKey);
  const result = await falPoll(reqId, "fal-ai/imageutils/rembg", falKey);
  const url = (result.image as { url: string })?.url ?? (result as { url?: string }).url;
  if (!url) throw new Error("rembg: no output URL");
  return url;
}

async function upscale(imageUrl: string, falKey: string): Promise<string> {
  const reqId = await falSubmit(FAL_UPSCALE, {
    image_url: imageUrl,
    scale_factor: 4,
    creativity: 0.25, // low creativity = faithful upscale
    detail_boost: true,
  }, falKey);
  const result = await falPoll(reqId, "fal-ai/clarity-upscaler", falKey);
  const url = (result.image as { url: string })?.url ?? (result as { url?: string }).url;
  if (!url) throw new Error("upscaler: no output URL");
  return url;
}

async function uploadToStorage(imageUrl: string, supabaseUrl: string, supabaseKey: string): Promise<string> {
  // Download image from fal.ai
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imgRes.ok) throw new Error("Failed to download enhanced image");
  const buf = await imgRes.arrayBuffer();
  const mimeType = imgRes.headers.get("content-type")?.split(";")[0] ?? "image/png";
  const ext = mimeType.includes("png") ? "png" : "jpg";

  // Upload to Supabase
  const key = `enhanced/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/videos/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": mimeType,
    },
    body: buf,
  });
  if (!uploadRes.ok) throw new Error("Failed to upload enhanced image to storage");
  return `${supabaseUrl}/storage/v1/object/public/videos/${key}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { resolveApiKey } = await import("@/lib/user-keys");
  const falKey = await resolveApiKey("fal", process.env.FAL_API_KEY);
  if (!falKey) {
    return NextResponse.json({ error: "FAL_API_KEY не настроен" }, { status: 500 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let body: Input;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { imageUrl, enhanceType, slotType = "other" } = body;
  if (!imageUrl || !enhanceType) {
    return NextResponse.json({ error: "imageUrl and enhanceType required" }, { status: 400 });
  }

  // SSRF protection
  try {
    const u = new URL(imageUrl);
    if (PRIVATE_IP_RE.test(u.hostname)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    let resultUrl = imageUrl;

    // Logo / product → remove-bg first, then optionally upscale
    // Hero → only upscale (keep background for now, or remove if requested)
    if (enhanceType === "remove-bg" || enhanceType === "both") {
      resultUrl = await removeBg(resultUrl, falKey);
    }

    if (enhanceType === "upscale" || enhanceType === "both") {
      resultUrl = await upscale(resultUrl, falKey);
    }

    // Re-upload to own storage so URL stays stable
    let finalUrl = resultUrl;
    if (supabaseUrl && supabaseKey) {
      try {
        finalUrl = await uploadToStorage(resultUrl, supabaseUrl, supabaseKey);
      } catch {
        // Fallback: use fal.ai URL directly (shorter-lived)
        finalUrl = resultUrl;
      }
    }

    const operations: string[] = [];
    if (enhanceType === "remove-bg" || enhanceType === "both") operations.push("фон удалён");
    if (enhanceType === "upscale" || enhanceType === "both") operations.push("разрешение ×4");

    return NextResponse.json({
      url: finalUrl,
      operations,
      slotType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Enhancement failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
