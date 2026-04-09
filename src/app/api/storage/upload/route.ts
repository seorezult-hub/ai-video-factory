import { NextRequest, NextResponse } from "next/server";

// NOTE: Cloudflare R2 binding is only available in Cloudflare Workers environment.
// In development, this uploads to Supabase Storage as a fallback.
export const runtime = "edge";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const key = formData.get("key") as string;

  if (!file || !key) {
    return NextResponse.json({ error: "Missing file or key" }, { status: 400 });
  }

  // In production (Cloudflare Workers), use R2 binding
  // For now, use Supabase Storage
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/videos/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!uploadRes.ok) {
    return NextResponse.json({ error: "Upload failed" }, { status: 502 });
  }

  const url = `${supabaseUrl}/storage/v1/object/public/videos/${key}`;
  return NextResponse.json({ url });
}
