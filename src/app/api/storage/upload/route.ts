import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

// NOTE: Cloudflare R2 binding is only available in Cloudflare Workers environment.
// In development, this uploads to Supabase Storage as a fallback.
export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_MIME = ["audio/mpeg", "audio/mp4", "audio/wav", "video/mp4"];
const ALLOWED_MIME = [...IMAGE_MIME, ...VIDEO_MIME];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

// Magic bytes for supported types
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png":  (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  "video/mp4":  (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // ftyp box
  "audio/mpeg": (b) => (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33), // MP3 sync or ID3
  "audio/mp4":  (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  "audio/wav":  (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46,
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "upload", 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const rawKey = formData.get("key") as string | null;

  if (!file || !rawKey) {
    return NextResponse.json({ error: "Missing file or key" }, { status: 400 });
  }

  const isImage = IMAGE_MIME.includes(file.type);
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;

  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  if (file.size > maxSize) {
    return NextResponse.json({ error: `File too large (max ${isImage ? "10" : "100"} MB)` }, { status: 400 });
  }

  // Magic bytes MIME validation (prevents content-type spoofing)
  const headerBuf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const checker = MAGIC[file.type];
  if (checker && !checker(headerBuf)) {
    return NextResponse.json({ error: "File content does not match declared type" }, { status: 400 });
  }

  // Sanitize key: remove path traversal, allow only safe characters
  const key = rawKey.replace(/\.\./g, "").replace(/[^a-zA-Z0-9/_.\-]/g, "").slice(0, 500);
  if (!key) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  // In production (Cloudflare Workers), use R2 binding
  // For now, use Supabase Storage
  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/videos/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });

  if (!uploadRes.ok) {
    return NextResponse.json({ error: "Upload failed" }, { status: 502 });
  }

  const url = `${supabaseUrl}/storage/v1/object/public/videos/${key}`;
  return NextResponse.json({ url });
}
