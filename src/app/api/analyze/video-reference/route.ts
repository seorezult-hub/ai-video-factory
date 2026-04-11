import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, rm, readFile } from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

export type VideoAnalysis = {
  cameraStyle: string;
  pacing: string;
  editingStyle: string;
  lightingStyle: string;
  colorGrade: string;
  moodKeywords: string[];
  cameraMovements: string[];
  shotTypes: string[];
  recommendations: string;   // injection-ready paragraph for script/prompt-engineer
};

function isSafeVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false; // только HTTPS для видео
    const h = u.hostname;
    // IPv4 private/loopback
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return false;
    if (h === "169.254.169.254" || h === "metadata.google.internal") return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    // IPv6 private/loopback
    if (h === "::1" || h === "[::1]") return false;
    if (/^\[?fc/i.test(h) || /^\[?fd/i.test(h)) return false;
    if (/^\[?fe80/i.test(h)) return false;
    if (/^\[?::ffff:/i.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

async function extractFrames(videoUrl: string, tmpDir: string): Promise<string[]> {
  // Extract 6 frames at evenly-spaced intervals from first 30 sec
  // ffmpeg reads directly from URL — no need to download the full file
  const outputPattern = path.join(tmpDir, "frame_%02d.jpg");

  // Select frames at 0, 5, 10, 15, 20, 25 seconds
  await execFileAsync("ffmpeg", [
    "-i", videoUrl,
    "-t", "30",
    "-vf", "select='eq(n,0)+eq(n,1)+eq(n,2)+eq(n,3)+eq(n,4)+eq(n,5)',setpts=N/FRAME_RATE/TB,fps=1/5,scale=768:-1",
    "-vsync", "vfr",
    "-q:v", "3",
    outputPattern,
  ], { timeout: 30_000 });

  // Collect extracted frames
  const frames: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const framePath = path.join(tmpDir, `frame_0${i}.jpg`);
    try {
      const buf = await readFile(framePath);
      frames.push(buf.toString("base64"));
    } catch {
      // Frame may not exist if video is shorter
    }
  }
  return frames;
}

async function analyzeWithGemini(frames: string[], geminiKey: string): Promise<VideoAnalysis> {
  const imageParts = frames.map((b64) => ({
    inline_data: { mime_type: "image/jpeg", data: b64 },
  }));

  const textPart = {
    text: `You are a cinematography analyst for premium brand commercials.
Analyze these ${frames.length} frames extracted from a reference video.

Return ONLY valid JSON matching this exact structure:
{
  "cameraStyle": "brief description of overall camera approach",
  "pacing": "edit rhythm, e.g. '1 cut per 3-4 seconds, slow and deliberate'",
  "editingStyle": "transition types, color matching, e.g. 'cross-dissolves, warm-to-warm cuts'",
  "lightingStyle": "main lighting approach, e.g. 'warm golden hour, high contrast rim light'",
  "colorGrade": "dominant color palette and grade, e.g. 'warm ambers, deep shadows, teal blacks'",
  "moodKeywords": ["3-5 mood/aesthetic keywords"],
  "cameraMovements": ["list of camera movements seen: slow push-in | tracking shot | static | slow orbit | dolly back | overhead | rack focus"],
  "shotTypes": ["list: extreme close-up | close-up | medium shot | wide shot | overhead"],
  "recommendations": "2-3 sentence paragraph with specific instructions for how to replicate this visual style in video prompts. Include camera movement instructions, lighting specifics, and pacing notes."
}

Analyze carefully: camera movements, lighting quality, color temperature, shot composition, editing rhythm, overall mood.`,
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [...imageParts, textPart] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini Vision error: ${res.status}`);
  }

  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty response");

  try {
    return JSON.parse(text) as VideoAnalysis;
  } catch {
    throw new Error("Failed to parse Gemini Vision JSON response");
  }
}

export async function POST(req: NextRequest) {
  let body: { videoUrl: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
  }

  if (!isSafeVideoUrl(body.videoUrl)) {
    return NextResponse.json({ error: "Invalid or unsafe video URL" }, { status: 400 });
  }

  const { resolveApiKey } = await import("@/lib/user-keys");
  const geminiKey = await resolveApiKey("gemini", process.env.GEMINI_API_KEY);
  if (!geminiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const tmpDir = path.join(os.tmpdir(), `video-ref-${Date.now()}`);

  try {
    await mkdir(tmpDir, { recursive: true });
    console.log(`[video-reference] extracting frames from: ${body.videoUrl.substring(0, 80)}`);

    const frames = await extractFrames(body.videoUrl, tmpDir);

    if (frames.length === 0) {
      return NextResponse.json(
        { error: "Could not extract frames from video. Make sure the URL points to a direct mp4 file." },
        { status: 422 }
      );
    }

    console.log(`[video-reference] extracted ${frames.length} frames, analyzing with Gemini Vision`);

    const analysis = await analyzeWithGemini(frames, geminiKey);

    console.log(`[video-reference] analysis complete: mood=${analysis.moodKeywords.join(",")}`);

    return NextResponse.json({ analysis, framesExtracted: frames.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[video-reference] error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
