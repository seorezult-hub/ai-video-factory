import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Uses HuggingFace Inference API with Flux schnell (free)
const HF_API_URL =
  "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell";

type FramesInput = {
  script: Array<{
    sceneNumber: number;
    visualPrompt: string;
  }>;
  brandName: string;
  mood: string;
  uploadedImages: string[];
};

export async function POST(req: NextRequest) {
  const body: FramesInput = await req.json();
  const hfToken = process.env.HUGGINGFACE_TOKEN;

  if (!hfToken) {
    return NextResponse.json({ error: "HUGGINGFACE_TOKEN not configured" }, { status: 500 });
  }

  // Generate frames in parallel (max 3 at a time to avoid rate limits)
  const batchSize = 3;
  const keyframes: string[] = [];

  for (let i = 0; i < body.script.length; i += batchSize) {
    const batch = body.script.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (scene) => {
        const prompt = scene.visualPrompt
          .replace(/@Image\d+/gi, "a product")
          .trim();

        const res = await fetch(HF_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              width: 1280,
              height: 720,
              num_inference_steps: 4,
            },
          }),
        });

        if (!res.ok) {
          throw new Error(`HuggingFace error for scene ${scene.sceneNumber}: ${await res.text()}`);
        }

        // Returns binary image — upload to R2 via presigned URL
        const imageBlob = await res.blob();
        const uploadUrl = await uploadToR2(imageBlob, `frames/${Date.now()}-scene${scene.sceneNumber}.jpg`);
        return uploadUrl;
      })
    );
    keyframes.push(...batchResults);
  }

  return NextResponse.json({ keyframes });
}

async function uploadToR2(blob: Blob, key: string): Promise<string> {
  // Upload via API route that has R2 binding
  const formData = new FormData();
  formData.append("file", blob, key);
  formData.append("key", key);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/storage/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error("R2 upload failed");
  const { url } = await res.json();
  return url;
}
