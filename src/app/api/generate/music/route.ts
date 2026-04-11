import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveApiKey } from "@/lib/user-keys";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const PIAPI_SUBMIT_URL = "https://api.piapi.ai/api/suno/v1/music";
const PIAPI_STATUS_URL = "https://api.piapi.ai/api/suno/v1/music";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 110_000;

type MusicInput = {
  mood: string;
  brandName: string;
  duration: number;
  style?: string;
};

type MusicOutput = {
  musicUrl: string;
  title: string;
  provider: "suno" | "fallback";
};

const MOOD_PROMPTS: Record<string, string> = {
  luxury: "elegant luxury cinematic orchestral, subtle piano and strings, slow tempo, premium brand commercial",
  energetic: "upbeat dynamic electronic, driving beat, high energy, fast tempo, brand commercial",
  minimal: "minimalist ambient, soft synth pads, clean and airy, slow tempo, modern brand",
  dramatic: "epic cinematic orchestral, powerful strings and brass, building tension, brand commercial",
  playful: "light cheerful pop, bright melody, fun upbeat, medium tempo, brand commercial",
  dark: "dark atmospheric electronic, deep bass, moody synths, slow tempo, premium brand",
};

function getFallbackUrl(mood: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const moodKey = MOOD_PROMPTS[mood] ? mood : "minimal";
  return `${base}/storage/v1/object/public/assets/music/${moodKey}.mp3`;
}

async function submitSunoJob(
  mood: string,
  brandName: string,
  duration: number,
  style: string | undefined,
  apiKey: string
): Promise<string> {
  const moodDesc = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS["minimal"];
  const styleExtra = style ? `, ${style}` : "";
  const prompt = `${moodDesc}${styleExtra}, background music for ${brandName} brand commercial video, ${duration} seconds, no lyrics, no vocals, instrumental only`;

  const res = await fetch(PIAPI_SUBMIT_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      gpt_description_prompt: prompt,
      make_instrumental: true,
      mv: "chirp-v4",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`piapi submit error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const taskId: string = data?.data?.task_id ?? data?.task_id ?? "";
  if (!taskId) throw new Error("piapi did not return task_id");
  return taskId;
}

async function pollSunoJob(
  taskId: string,
  apiKey: string
): Promise<{ audioUrl: string; title: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${PIAPI_STATUS_URL}/${taskId}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[music] poll error ${res.status}, retrying`);
      continue;
    }

    const data = await res.json();
    const status: string = data?.data?.status ?? data?.status ?? "";

    if (status === "completed" || status === "success") {
      const clips: Array<{ audio_url?: string; title?: string }> =
        data?.data?.clips ?? data?.clips ?? [];
      const first = clips[0];
      const audioUrl = first?.audio_url ?? "";
      if (!audioUrl) throw new Error("piapi completed but no audio_url");
      return { audioUrl, title: first?.title ?? "Brand Music" };
    }

    if (status === "failed" || status === "error") {
      const msg = data?.data?.error_message ?? data?.error_message ?? "unknown";
      throw new Error(`piapi job failed: ${msg}`);
    }
  }

  throw new Error("piapi polling timed out");
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "music", 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: MusicInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { mood, brandName, duration, style } = body;

  if (!mood || typeof mood !== "string") {
    return NextResponse.json({ error: "mood is required" }, { status: 400 });
  }
  if (!brandName || typeof brandName !== "string") {
    return NextResponse.json({ error: "brandName is required" }, { status: 400 });
  }
  if (typeof duration !== "number" || duration < 5 || duration > 120) {
    return NextResponse.json(
      { error: "duration must be a number between 5 and 120" },
      { status: 400 }
    );
  }

  const piApiKey = await resolveApiKey("piapi", process.env.PIAPI_KEY);

  if (!piApiKey) {
    console.warn("[music] PIAPI_KEY not configured — using fallback tracks");
    const result: MusicOutput = {
      musicUrl: getFallbackUrl(mood),
      title: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Brand Music`,
      provider: "fallback",
    };
    return NextResponse.json(result);
  }

  try {
    const taskId = await submitSunoJob(mood, brandName, duration, style, piApiKey);
    console.log(`[music] submitted suno job: ${taskId}`);

    const { audioUrl, title } = await pollSunoJob(taskId, piApiKey);
    console.log(`[music] completed: ${audioUrl.substring(0, 80)}`);

    const result: MusicOutput = {
      musicUrl: audioUrl,
      title,
      provider: "suno",
    };
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[music] suno error, falling back:`, msg);

    const result: MusicOutput = {
      musicUrl: getFallbackUrl(mood),
      title: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Brand Music`,
      provider: "fallback",
    };
    return NextResponse.json(result);
  }
}
