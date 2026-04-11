import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);

type ExportFormat = "1:1" | "16:9" | "4:5";

type ExportInput = {
  videoUrl: string;
  targetFormat: ExportFormat;
  sourceFormat?: string; // "9:16" | "16:9"
};

const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0)/;

// ─── FFmpeg фильтры для каждого формата ─────────────────────────────────────
function buildFFmpegFilter(sourceFormat: string, targetFormat: ExportFormat): string {
  // 9:16 → 1:1: обрезаем верх и низ (берём центральный квадрат)
  if (targetFormat === "1:1") {
    return `crop=iw:iw:0:(ih-iw)/2`;
  }

  // 9:16 → 4:5: обрезаем верх и низ (4:5 = 0.8, 9:16 = 0.5625 → берём iw × 5/4)
  if (targetFormat === "4:5") {
    return `crop=iw:iw*5/4:0:(ih-iw*5/4)/2`;
  }

  // 9:16 → 16:9: добавляем размытый фон по бокам (blur-background technique)
  if (targetFormat === "16:9" && sourceFormat === "9:16") {
    // Масштаб: вертикальное видео вписываем по высоте в 1920×1080
    // Фон: то же видео, растянутое на 1920×1080 и размытое
    return [
      `[0:v]split=2[bg_src][fg_src]`,
      `[bg_src]scale=1920:1080,setsar=1,boxblur=40:5[bg]`,
      `[fg_src]scale=-2:1080,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`,
    ].join(";");
  }

  // 16:9 → 1:1: обрезаем по центру
  if (sourceFormat === "16:9") {
    return `crop=ih:ih:(iw-ih)/2:0`;
  }

  // Fallback: без изменений
  return `copy`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "export", 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  let body: ExportInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { videoUrl, targetFormat, sourceFormat = "9:16" } = body;
  if (!videoUrl || !targetFormat) {
    return NextResponse.json({ error: "videoUrl and targetFormat required" }, { status: 400 });
  }

  // SSRF protection: BUG-012 — только https:, блокируем file://, http://, etc.
  try {
    const u = new URL(videoUrl);
    if (u.protocol !== "https:") {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (PRIVATE_IP_RE.test(u.hostname)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Check FFmpeg
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    return NextResponse.json({ error: "FFmpeg не установлен на сервере" }, { status: 500 });
  }

  const id = randomUUID();
  const inputPath = join(tmpdir(), `export-in-${id}.mp4`);
  const outputPath = join(tmpdir(), `export-out-${id}.mp4`);

  try {
    // Скачиваем исходное видео
    const videoRes = await fetch(videoUrl, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (videoRes.status >= 300 && videoRes.status < 400) throw new Error("SSRF: redirect blocked");
    if (!videoRes.ok) throw new Error("Не удалось скачать исходное видео");
    // BUG-027: защита от OOM — ограничиваем размер файла 500 МБ
    const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
    const contentLength = parseInt(videoRes.headers.get("content-length") ?? "0");
    if (contentLength > MAX_VIDEO_BYTES) {
      throw new Error("Video file too large (>500MB)");
    }
    const videoBuf = await videoRes.arrayBuffer();
    if (videoBuf.byteLength > MAX_VIDEO_BYTES) {
      throw new Error("Video file too large (>500MB)");
    }
    await writeFile(inputPath, Buffer.from(videoBuf));

    // Строим FFmpeg команду
    const filter = buildFFmpegFilter(sourceFormat, targetFormat);
    const isComplexFilter = filter.includes(";"); // сложный filter_complex для blur-bg

    const ffmpegArgs = isComplexFilter
      ? ["-y", "-i", inputPath, "-filter_complex", filter, "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-c:a", "aac", "-movflags", "+faststart", outputPath]
      : ["-y", "-i", inputPath, "-vf", filter, "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-c:a", "aac", "-movflags", "+faststart", outputPath];

    await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 90_000 });

    // BUG-028: проверка что FFmpeg создал непустой файл
    const resultBuf = await readFile(outputPath);
    if (resultBuf.length === 0) {
      throw new Error("FFmpeg produced empty output file");
    }
    const key = `exports/${id}-${targetFormat.replace(":", "x")}.mp4`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/videos/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "video/mp4",
      },
      body: resultBuf,
    });

    if (!uploadRes.ok) throw new Error("Ошибка загрузки результата");

    const exportUrl = `${supabaseUrl}/storage/v1/object/public/videos/${key}`;
    return NextResponse.json({ url: exportUrl, format: targetFormat });

  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
