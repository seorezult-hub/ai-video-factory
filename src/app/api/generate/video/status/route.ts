import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/user-keys";

export const runtime = "nodejs";
export const maxDuration = 20;

const ALLOWED_STATUS_HOSTS = new Set(["api.atlascloud.ai", "queue.fal.run", "fal.run"]);

function isSafeStatusUrl(url: string): boolean {
  try {
    return ALLOWED_STATUS_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function fetchWithTimeout(url: string, options: RequestInit, ms = 12_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// Atlas Cloud: polling endpoint returns { data: { status, outputs: [url] } }
async function pollAtlas(statusUrl: string, atlasKey: string): Promise<NextResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(statusUrl, {
      headers: { Authorization: `Bearer ${atlasKey}` },
    });
  } catch {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  type AtlasResponse = { data?: { status?: string; outputs?: string[]; error?: string; message?: string } };
  let data: AtlasResponse;
  try {
    data = (await res.json()) as AtlasResponse;
  } catch {
    console.error(`[video/status] Atlas returned non-JSON response (${res.status})`);
    return NextResponse.json({ status: "IN_PROGRESS" });
  }
  // Atlas может вернуть HTTP 500 с телом содержащим статус failed — не игнорируем
  const status: string = data?.data?.status ?? "";
  console.log(`[video/status] atlas ${statusUrl.substring(0, 80)} → ${status}`);

  if (status === "completed" || status === "succeeded") {
    const videoUrl: string = data?.data?.outputs?.[0] ?? "";
    if (!videoUrl) {
      console.error(`[video/status] Atlas COMPLETED but no URL:`, JSON.stringify(data).substring(0, 300));
      return NextResponse.json({ status: "COMPLETED_NO_URL" });
    }
    console.log(`[video/status] Atlas completed, url: ${videoUrl.substring(0, 80)}`);
    return NextResponse.json({ status: "COMPLETED", videoUrl });
  }

  if (status === "failed" || status === "error") {
    const errMsg = data?.data?.error ?? data?.data?.message ?? "Atlas generation failed";
    console.error(`[video/status] Atlas FAILED:`, errMsg);
    return NextResponse.json({ status: "FAILED", error: errMsg });
  }

  // pending, processing, running — продолжаем ждать
  return NextResponse.json({ status: "IN_PROGRESS" });
}

// fal.ai: statusUrl → check status, then responseUrl → get video URL
async function pollFal(statusUrl: string, responseUrl: string, falKey: string): Promise<NextResponse> {
  let statusRes: Response;
  try {
    statusRes = await fetchWithTimeout(statusUrl, {
      headers: { Authorization: `Key ${falKey}` },
    });
  } catch {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  if (!statusRes.ok) return NextResponse.json({ status: "IN_PROGRESS" });

  const statusData = await statusRes.json();
  const status: string = statusData.status;
  console.log(`[video/status] fal ${statusUrl.substring(0, 80)} → ${status}`);

  if (status === "COMPLETED") {
    let resultRes: Response;
    try {
      resultRes = await fetchWithTimeout(responseUrl, {
        headers: { Authorization: `Key ${falKey}` },
      });
    } catch {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }
    type FalResult = { video?: { url?: string }; videos?: Array<{ url?: string }>; output?: { video?: { url?: string }; videos?: Array<{ url?: string }> }; url?: string };
    let result: FalResult;
    try {
      result = (await resultRes.json()) as FalResult;
    } catch {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }

    const videoUrl: string =
      result.video?.url ??
      result.videos?.[0]?.url ??
      result.output?.video?.url ??
      result.output?.videos?.[0]?.url ??
      result.url ??
      "";

    if (!videoUrl) {
      console.error(`[video/status] fal COMPLETED but no URL:`, JSON.stringify(result).substring(0, 500));
      return NextResponse.json({ status: "COMPLETED_NO_URL" });
    }

    console.log(`[video/status] fal completed, url: ${videoUrl.substring(0, 80)}`);
    return NextResponse.json({ status: "COMPLETED", videoUrl });
  }

  if (status === "FAILED") {
    const errMsg = statusData.error ?? statusData.detail ?? JSON.stringify(statusData).substring(0, 200);
    console.error(`[video/status] fal FAILED:`, errMsg);
    return NextResponse.json({ status: "FAILED", error: errMsg });
  }

  return NextResponse.json({ status: status ?? "IN_PROGRESS" });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusUrl = searchParams.get("statusUrl");
  const responseUrl = searchParams.get("responseUrl");

  if (!statusUrl || !responseUrl) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  if (!isSafeStatusUrl(statusUrl) || !isSafeStatusUrl(responseUrl)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Определяем провайдера по URL
  if (new URL(statusUrl).hostname === "api.atlascloud.ai") {
    const atlasKey = await resolveApiKey("atlas", process.env.ATLAS_CLOUD_API_KEY);
    if (!atlasKey) return NextResponse.json({ error: "ATLAS_CLOUD_API_KEY not configured" }, { status: 500 });
    return pollAtlas(statusUrl, atlasKey);
  }

  // fal.ai
  const falKey = await resolveApiKey("fal", process.env.FAL_API_KEY);
  if (!falKey) return NextResponse.json({ error: "FAL_API_KEY not configured" }, { status: 500 });
  return pollFal(statusUrl, responseUrl, falKey);
}
