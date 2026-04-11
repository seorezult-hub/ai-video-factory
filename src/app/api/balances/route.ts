import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Стоимость одного премиального ролика (стиль Егора Кузьмина / XR School):
// 1 сцена Seedance = 10 сек непрерывного кинематографичного плана
// Финальный ролик: 5 сцен × 10 сек = 50 сек (premium brand film)
// Atlas: 5 клипов × 10 сек × $0.022 = $1.10
// fal.ai: 5 ключевых кадров × $0.005 (Flux/Recraft) = $0.025
// piapi: 1 герой MJ v7 × $0.08 = $0.08
// ElevenLabs: ~1200 символов войсовер (50 сек озвучки)
const COST_PER_VIDEO: Record<string, number | null> = {
  atlas:       1.10,  // $1.10 — 5 клипов × 10 сек × $0.022
  fal:         0.025, // $0.025 — 5 ключевых кадров
  piapi:       0.08,  // $0.08 — генерация героя/персонажа
  elevenlabs:  1200,  // 1200 симв. войсовер (50 сек озвучки)
  groq:        null,  // бесплатно — не считаем
  gemini:      null,  // API key — не считаем
};

type ServiceBalance = {
  service: string;
  label: string;
  balance: number | null;
  currency: string;
  unit: string;
  status: "ok" | "low" | "empty" | "unknown" | "error";
  topupUrl: string;
  videosRemaining: number | null;
  costPerVideo: number | null;
  error?: string;
};

async function fetchWithTimeout(url: string, options: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function calcVideos(balance: number | null, service: string): number | null {
  const cost = COST_PER_VIDEO[service];
  if (balance === null || cost === null || cost === 0) return null;
  return Math.floor(balance / cost);
}

async function getFalBalance(): Promise<ServiceBalance> {
  const key = process.env.FAL_API_KEY;
  if (!key) return { service: "fal", label: "fal.ai", balance: null, currency: "$", unit: "USD", status: "unknown", topupUrl: "https://fal.ai/dashboard/billing", videosRemaining: null, costPerVideo: COST_PER_VIDEO.fal, error: "FAL_API_KEY not set" };
  try {
    const res = await fetchWithTimeout("https://fal.ai/api/billing/account", {
      headers: { Authorization: `Key ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const balance = typeof data.balance === "number" ? data.balance :
                    typeof data.credits === "number" ? data.credits : null;
    const usd = balance !== null ? Math.round(balance * 100) / 100 : null;
    return {
      service: "fal",
      label: "fal.ai",
      balance: usd,
      currency: "$",
      unit: "USD",
      status: usd === null ? "unknown" : usd < 1 ? "empty" : usd < 5 ? "low" : "ok",
      topupUrl: "https://fal.ai/dashboard/billing",
      videosRemaining: calcVideos(usd, "fal"),
      costPerVideo: COST_PER_VIDEO.fal,
    };
  } catch (e) {
    console.error("[balances] fal error:", e);
    return { service: "fal", label: "fal.ai", balance: null, currency: "$", unit: "USD", status: "error", topupUrl: "https://fal.ai/dashboard/billing", videosRemaining: null, costPerVideo: COST_PER_VIDEO.fal, error: "Failed to fetch balance" };
  }
}

async function getAtlasBalance(): Promise<ServiceBalance> {
  const key = process.env.ATLAS_CLOUD_API_KEY;
  if (!key) return { service: "atlas", label: "Atlas Cloud (Seedance)", balance: null, currency: "$", unit: "USD", status: "unknown", topupUrl: "https://atlascloud.ai/billing", videosRemaining: null, costPerVideo: COST_PER_VIDEO.atlas, error: "ATLAS_CLOUD_API_KEY not set" };
  try {
    const res = await fetchWithTimeout("https://api.atlascloud.ai/api/v1/billing/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const balance = data.balance ?? data.credits ?? data.data?.balance ?? null;
    const usd = balance !== null ? Math.round(Number(balance) * 100) / 100 : null;
    return {
      service: "atlas",
      label: "Atlas Cloud (Seedance)",
      balance: usd,
      currency: "$",
      unit: "USD",
      status: usd === null ? "unknown" : usd < 2 ? "empty" : usd < 10 ? "low" : "ok",
      topupUrl: "https://atlascloud.ai/billing",
      videosRemaining: calcVideos(usd, "atlas"),
      costPerVideo: COST_PER_VIDEO.atlas,
    };
  } catch (e) {
    console.error("[balances] atlas error:", e);
    return { service: "atlas", label: "Atlas Cloud (Seedance)", balance: null, currency: "$", unit: "USD", status: "error", topupUrl: "https://atlascloud.ai/billing", videosRemaining: null, costPerVideo: COST_PER_VIDEO.atlas, error: "Failed to fetch balance" };
  }
}

async function getPiapiBalance(): Promise<ServiceBalance> {
  const key = process.env.PIAPI_KEY;
  if (!key) return { service: "piapi", label: "piapi.ai (Midjourney)", balance: null, currency: "$", unit: "USD", status: "unknown", topupUrl: "https://piapi.ai/dashboard", videosRemaining: null, costPerVideo: COST_PER_VIDEO.piapi, error: "PIAPI_KEY not set" };
  try {
    const res = await fetchWithTimeout("https://api.piapi.ai/api/user/balance", {
      headers: { "x-api-key": key },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const balance = data.balance ?? data.data?.balance ?? data.credits ?? null;
    const usd = balance !== null ? Math.round(Number(balance) * 100) / 100 : null;
    return {
      service: "piapi",
      label: "piapi.ai (Midjourney)",
      balance: usd,
      currency: "$",
      unit: "USD",
      status: usd === null ? "unknown" : usd < 1 ? "empty" : usd < 5 ? "low" : "ok",
      topupUrl: "https://piapi.ai/dashboard",
      videosRemaining: calcVideos(usd, "piapi"),
      costPerVideo: COST_PER_VIDEO.piapi,
    };
  } catch (e) {
    console.error("[balances] piapi error:", e);
    return { service: "piapi", label: "piapi.ai (Midjourney)", balance: null, currency: "$", unit: "USD", status: "error", topupUrl: "https://piapi.ai/dashboard", videosRemaining: null, costPerVideo: COST_PER_VIDEO.piapi, error: "Failed to fetch balance" };
  }
}

async function getElevenLabsBalance(): Promise<ServiceBalance> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { service: "elevenlabs", label: "ElevenLabs (Голос)", balance: null, currency: "", unit: "симв.", status: "unknown", topupUrl: "https://elevenlabs.io/app/subscription", videosRemaining: null, costPerVideo: COST_PER_VIDEO.elevenlabs, error: "ELEVENLABS_API_KEY not set" };
  try {
    const res = await fetchWithTimeout("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const used = data.subscription?.character_count ?? 0;
    const limit = data.subscription?.character_limit ?? 0;
    const remaining = Math.max(0, limit - used);
    const pct = limit > 0 ? remaining / limit : 0;
    return {
      service: "elevenlabs",
      label: "ElevenLabs (Голос)",
      balance: remaining,
      currency: "",
      unit: "симв.",
      status: pct < 0.05 ? "empty" : pct < 0.2 ? "low" : "ok",
      topupUrl: "https://elevenlabs.io/app/subscription",
      videosRemaining: calcVideos(remaining, "elevenlabs"),
      costPerVideo: COST_PER_VIDEO.elevenlabs,
    };
  } catch (e) {
    console.error("[balances] elevenlabs error:", e);
    return { service: "elevenlabs", label: "ElevenLabs (Голос)", balance: null, currency: "", unit: "симв.", status: "error", topupUrl: "https://elevenlabs.io/app/subscription", videosRemaining: null, costPerVideo: COST_PER_VIDEO.elevenlabs, error: "Failed to fetch balance" };
  }
}

async function getGroqStatus(): Promise<ServiceBalance> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { service: "groq", label: "Groq (Сценарий AI)", balance: null, currency: "", unit: "", status: "unknown", topupUrl: "https://console.groq.com", videosRemaining: null, costPerVideo: null, error: "GROQ_API_KEY not set" };
  try {
    const res = await fetchWithTimeout("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return {
      service: "groq",
      label: "Groq (Сценарий AI)",
      balance: null,
      currency: "",
      unit: "",
      status: res.ok ? "ok" : "error",
      topupUrl: "https://console.groq.com",
      videosRemaining: null,
      costPerVideo: null,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    console.error("[balances] groq error:", e);
    return { service: "groq", label: "Groq (Сценарий AI)", balance: null, currency: "", unit: "", status: "error", topupUrl: "https://console.groq.com", videosRemaining: null, costPerVideo: null, error: "Failed to check status" };
  }
}

async function getGeminiStatus(): Promise<ServiceBalance> {
  const key = process.env.GEMINI_API_KEY;
  return {
    service: "gemini",
    label: "Gemini (Анализ)",
    balance: null,
    currency: "",
    unit: "",
    status: key ? "ok" : "unknown",
    topupUrl: "https://aistudio.google.com",
    videosRemaining: null,
    costPerVideo: null,
    error: key ? undefined : "GEMINI_API_KEY not set",
  };
}

export type BalanceShorthand = {
  balance: number | null;
  available: boolean;
  currency: "USD";
};

export async function GET() {
  const results = await Promise.allSettled([
    getFalBalance(),
    getAtlasBalance(),
    getPiapiBalance(),
    getElevenLabsBalance(),
    getGroqStatus(),
    getGeminiStatus(),
  ]);

  const balances: ServiceBalance[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { service: "unknown", label: "Unknown", balance: null, currency: "$", unit: "", status: "error" as const, topupUrl: "#", videosRemaining: null, costPerVideo: null }
  );

  const atlasSvc = balances.find((b) => b.service === "atlas");
  const falSvc   = balances.find((b) => b.service === "fal");

  const atlas: BalanceShorthand = {
    balance:   atlasSvc?.balance ?? null,
    available: atlasSvc?.balance === null ? true : (atlasSvc?.balance ?? 0) > 0.50,
    currency:  "USD",
  };

  const fal: BalanceShorthand = {
    balance:   falSvc?.balance ?? null,
    available: falSvc?.balance === null ? true : (falSvc?.balance ?? 0) > 0.50,
    currency:  "USD",
  };

  return NextResponse.json({ balances, atlas, fal, fetchedAt: new Date().toISOString() });
}
