import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type AssembleInput = {
  clips: string[]; // R2 URLs
  musicUrl: string | null;
  brandName: string;
};

// Assembly is done by n8n workflow via FFmpeg
// This route triggers the n8n webhook and waits for the result
export async function POST(req: NextRequest) {
  const body: AssembleInput = await req.json();
  const n8nWebhookUrl = process.env.N8N_ASSEMBLE_WEBHOOK_URL;

  if (!n8nWebhookUrl) {
    return NextResponse.json({ error: "N8N_ASSEMBLE_WEBHOOK_URL not configured" }, { status: 500 });
  }

  const res = await fetch(n8nWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clips: body.clips,
      musicUrl: body.musicUrl,
      brandName: body.brandName,
      outputFormat: "mp4",
      aspectRatio: "9:16",
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Assembly webhook failed" }, { status: 502 });
  }

  const { videoUrl } = await res.json();
  return NextResponse.json({ videoUrl });
}
