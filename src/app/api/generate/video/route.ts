import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Kling Free API via fal.ai (fallback when Kling direct hits rate limit)
const FAL_API_URL = "https://queue.fal.run/fal-ai/kling-video/v2/standard/image-to-video";

type VideoInput = {
  script: Array<{
    sceneNumber: number;
    visualPrompt: string;
    cameraMovement: string;
    duration: string;
  }>;
  keyframes: string[]; // R2 URLs for each scene
  mood: string;
};

export async function POST(req: NextRequest) {
  const body: VideoInput = await req.json();
  const falKey = process.env.FAL_API_KEY;

  if (!falKey) {
    return NextResponse.json({ error: "FAL_API_KEY not configured" }, { status: 500 });
  }

  // Submit all scenes to fal.ai queue
  const requestIds = await Promise.all(
    body.script.map(async (scene, i) => {
      const keyframeUrl = body.keyframes[i];
      const duration = scene.duration.includes("10") ? "10" : "5";

      const res = await fetch(FAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: scene.visualPrompt,
          image_url: keyframeUrl,
          duration,
          aspect_ratio: "9:16",
          cfg_scale: 0.5,
        }),
      });

      if (!res.ok) {
        throw new Error(`fal.ai submit error for scene ${scene.sceneNumber}: ${await res.text()}`);
      }

      const { request_id } = await res.json();
      return request_id as string;
    })
  );

  // Poll for results (with timeout)
  const videoClips = await Promise.all(
    requestIds.map((requestId) => pollFalResult(requestId, falKey))
  );

  // Generate music with Suno (free tier via webhook in n8n)
  // For MVP: use a placeholder or trigger n8n webhook
  const musicUrl = await generateMusic(body.mood);

  return NextResponse.json({ videoClips, musicUrl });
}

async function pollFalResult(
  requestId: string,
  apiKey: string,
  maxWaitMs = 180_000
): Promise<string> {
  const statusUrl = `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    const { status } = await statusRes.json();

    if (status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const result = await resultRes.json();
      return result.video?.url ?? result.output?.video?.url ?? "";
    }

    if (status === "FAILED") {
      throw new Error(`fal.ai generation failed for request ${requestId}`);
    }
  }

  throw new Error(`Timeout waiting for fal.ai request ${requestId}`);
}

async function generateMusic(mood: string): Promise<string | null> {
  // Trigger n8n webhook to generate music via Suno
  const n8nWebhookUrl = process.env.N8N_MUSIC_WEBHOOK_URL;
  if (!n8nWebhookUrl) return null;

  try {
    const res = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood, duration: 30 }),
    });
    if (!res.ok) return null;
    const { musicUrl } = await res.json();
    return musicUrl;
  } catch {
    return null;
  }
}
