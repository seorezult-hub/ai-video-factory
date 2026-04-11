import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { probeFFmpegTransitions, getSafeTransition } from "@/lib/ffmpeg-probe";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

// Запускаем probe при первом импорте модуля (один раз на warm instance)
probeFFmpegTransitions().catch(e => console.error("[assemble] ffmpeg probe failed:", e));

export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

type SceneType = "nature" | "product" | "face" | "action" | "logo" | "unknown";

type SubtitleScene = {
  sceneNumber?: number;
  descriptionRu?: string;
  description?: string;
  duration?: string;
};

type AssembleInput = {
  clips: string[];
  musicUrl: string | null;
  voiceoverUrl?: string | null;
  brandName: string;
  aspectRatio?: string;
  mood?: string;        // Люкс | Энергия | Мягко и натурально | Дерзко | Минимализм | Игриво
  sceneTypes?: SceneType[]; // тип каждой сцены для умных переходов
  bpm?: number;         // BPM музыки для cuts в такт
  subtitles?: boolean;
  subtitleScript?: SubtitleScene[];
};

// ── Color grading по настроению ─────────────────────────────────────────────
// FFmpeg curves/colorbalance фильтры — не нужны внешние LUT файлы
function getColorGrade(mood: string): string {
  // ВАЖНО: vibrance НЕ существует в FFmpeg — заменён на colorbalance+eq
  // curves параметры ТОЛЬКО через ":" — запятая внутри curves ломает filter
  // colorbalance: rs/gs/bs = shadows, rm/gm/bm = midtones, rh/gh/bh = highlights
  switch (mood) {
    case "Люкс":
      // Тёплые золотые тона, глубокие тени, высокий контраст, лёгкая виньетка
      return [
        "curves=r='0/0 0.3/0.25 0.7/0.72 1/1':g='0/0 0.3/0.28 0.7/0.70 1/0.95':b='0/0 0.3/0.22 0.7/0.65 1/0.88'",
        "colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.05:bm=-0.05:rh=0.05:bh=-0.03",
        "eq=saturation=1.08:contrast=1.12:gamma=0.98",
        "vignette=PI/5",
      ].join(",");
    case "Энергия":
      // Высокий контраст, насыщенные цвета, холодные тени
      return [
        "curves=r='0/0 0.3/0.32 0.7/0.75 1/1':g='0/0 0.3/0.30 0.7/0.73 1/1':b='0/0 0.3/0.33 0.7/0.78 1/1'",
        "colorbalance=rs=-0.05:bs=0.08",
        "eq=contrast=1.18:saturation=1.28:gamma=0.97",
      ].join(",");
    case "Мягко и натурально":
      // Мягкие тени, тёплый матовый эффект, desaturated
      return [
        "curves=r='0/0.05 0.5/0.52 1/0.95':g='0/0.03 0.5/0.50 1/0.93':b='0/0.02 0.5/0.47 1/0.88'",
        "colorbalance=rs=0.04:bs=-0.06:rm=0.03:bm=-0.03",
        "eq=saturation=0.82:gamma=1.08:contrast=0.96",
      ].join(",");
    case "Дерзко":
      // Жёсткий контраст, холодные тени, горячие света, виньетка
      return [
        "curves=r='0/0 0.4/0.38 0.7/0.78 1/1':g='0/0 0.4/0.35 0.7/0.72 1/0.97':b='0/0.05 0.4/0.42 0.7/0.76 1/1'",
        "colorbalance=rs=0.06:bs=0.04:rh=0.08:bh=-0.04",
        "eq=contrast=1.28:saturation=1.02:gamma=0.94",
        "vignette=PI/4",
      ].join(",");
    case "Минимализм":
      // Почти ч/б, минимум цвета, чистый и холодный
      return [
        "curves=r='0/0 1/0.97':g='0/0 1/0.98':b='0/0.02 1/1'",
        "eq=saturation=0.38:gamma=1.10:contrast=1.06",
      ].join(",");
    case "Игриво":
      // Яркие цвета, тёплые, высокая насыщенность
      return [
        "curves=r='0/0 0.5/0.55 1/1':g='0/0 0.5/0.51 1/1':b='0/0 0.5/0.45 1/0.92'",
        "colorbalance=rs=0.05:gs=0.03:bs=-0.04",
        "eq=saturation=1.35:brightness=0.02:contrast=1.05",
      ].join(",");
    default:
      return "curves=r='0/0 0.5/0.51 1/1':g='0/0 0.5/0.50 1/1':b='0/0 0.5/0.49 1/0.98',eq=saturation=1.02";
  }
}

// ── Умный выбор перехода по типу сцены ──────────────────────────────────────
// VERIFIED xfade transitions (libavfilter/vf_xfade.c, FFmpeg 4.4+):
// dissolve, fadeblack, fadewhite, wipeleft, wiperight, wipeup, wipedown,
// slideleft, slideright, slideup, slidedown, circlecrop, rectcrop,
// circleopen, circleclose, horzopen, horzclose, vertopen, vertclose,
// radial, zoomin, pixelize, diagtl, diagtr, diagbl, diagbr,
// hlslice, hrslice, vuslice, vdslice, smoothleft, smoothright, smoothup, smoothdown,
// squeezeh, squeezev, distance, fadefast, fadeslow, fadegrays,
// wipetl, wipetr, wipebl, wipebr, coverleft, coverright, coverup, coverdown,
// revealleft, revealright, revealup, revealdown, hlwind, hrwind, vuwind, vdwind
//
// hblur — НЕ xfade transition (это отдельный video filter). Заменён на horzopen.
// vibrance — НЕ существует в FFmpeg. Заменён на colorbalance+eq.
function getTransition(fromType: SceneType, toType: SceneType, mood: string): { type: string; duration: number } {
  // Логотип — плавный финал в зависимости от настроения
  if (toType === "logo") {
    return mood === "Минимализм"
      ? { type: "fadewhite", duration: 1.0 }
      : { type: "fadeblack", duration: 0.8 };
  }
  // Nature → nature — органичный dissolve
  if (fromType === "nature" && toType === "nature") return { type: "dissolve", duration: 1.0 };
  // Face → product — zoom in к продукту
  if (fromType === "face" && toType === "product") return { type: "zoomin", duration: 0.6 };
  // К продукту из другого типа — театральное fadeblack
  if (toType === "product" && fromType !== "product") return { type: "fadeblack", duration: 0.6 };
  // Action сцены — горизонтальный открыв (horzopen = hblur замена)
  if (fromType === "action" || toType === "action") return { type: "horzopen", duration: 0.35 };
  // По настроению
  switch (mood) {
    case "Минимализм": return { type: "fadeblack", duration: 0.7 };
    case "Дерзко":     return { type: "pixelize",  duration: 0.3 };
    case "Энергия":    return { type: "horzopen",  duration: 0.28 };
    case "Игриво":     return { type: "slideup",   duration: 0.4 };
    case "Люкс":       return { type: "dissolve",  duration: 0.9 };
    default:           return { type: "dissolve",  duration: 0.7 };
  }
}

// ── BPM → длительность клипа (привязка к битам) ─────────────────────────────
function snapToBeat(duration: number, bpm: number): number {
  if (!bpm || bpm < 40 || bpm > 200) return duration;
  const beatDuration = 60 / bpm;
  const beats = Math.round(duration / beatDuration);
  return Math.max(beats, 2) * beatDuration; // минимум 2 бита
}

// ── ASS субтитры ─────────────────────────────────────────────────────────────
function toASSTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function generateASSSubtitles(scenes: SubtitleScene[], isVertical: boolean): string {
  const W = isVertical ? 1080 : 1920;
  const H = isVertical ? 1920 : 1080;
  const fontSize = isVertical ? 52 : 48;
  const marginV = isVertical ? 120 : 80;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let dialogue = "";
  let t = 0;
  for (const scene of scenes) {
    const dur = parseInt(scene.duration ?? "5") || 5;
    const text = (scene.descriptionRu ?? scene.description ?? "").replace(/\n/g, "\\N").trim();
    if (text) {
      const start = toASSTime(t);
      const end = toASSTime(t + dur - 0.2);
      dialogue += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
    }
    t += dur;
  }
  return header + dialogue;
}

function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 30_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

const ALLOWED_CLIP_HOSTS = ["supabase.co", "fal.media", "fal.run", "atlascloud.ai", "cdn.replicate.delivery", "storage.googleapis.com"];

function isSafeClipUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_CLIP_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "assemble", 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: AssembleInput;
  try {
    body = await req.json();
  } catch {
    return new Response(`data: ${JSON.stringify({ type: "error", error: "Invalid JSON body" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const validClips = body.clips.filter((u) => u && u.length > 0 && isSafeClipUrl(u));

  // Pre-validate clip availability via HEAD requests (до запуска FFmpeg)
  // Это предотвращает запуск сборки с недоступными клипами
  async function validateClipUrls(urls: string[]): Promise<{ valid: string[]; failed: number[] }> {
    const results = await Promise.allSettled(
      urls.map((url, i) =>
        fetchWithTimeout(url, { method: "HEAD", redirect: "manual" }, 10_000)
          .then(r => ({ i, ok: r.ok && r.status < 300 }))
          .catch(() => ({ i, ok: false }))
      )
    );
    const valid: string[] = [];
    const failed: number[] = [];
    results.forEach((r) => {
      const val = r.status === "fulfilled" ? r.value : { i: 0, ok: false };
      if (val.ok) valid.push(urls[val.i]);
      else failed.push(val.i + 1);
    });
    return { valid, failed };
  }

  // SSRF protection for audio URLs
  if (body.voiceoverUrl && !isSafeClipUrl(body.voiceoverUrl)) {
    return new Response(`data: ${JSON.stringify({ type: "error", error: "Invalid voiceover URL" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (body.musicUrl && !isSafeClipUrl(body.musicUrl)) {
    return new Response(`data: ${JSON.stringify({ type: "error", error: "Invalid music URL" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      if (validClips.length === 0) {
        send({ type: "error", error: "Нет клипов для сборки" });
        controller.close();
        return;
      }

      // Pre-validate clip URLs — проверяем доступность до запуска FFmpeg
      send({ type: "stage", stage: "validating", label: "Проверяю доступность клипов..." });
      const { valid: checkedClips, failed: failedIndices } = await validateClipUrls(validClips);
      if (failedIndices.length > 0) {
        send({ type: "warning", message: `Клипы ${failedIndices.join(", ")} недоступны — пропускаем` });
      }
      if (checkedClips.length === 0) {
        send({ type: "error", error: "Все клипы недоступны — сборка невозможна" });
        controller.close();
        return;
      }

      // FFmpeg precheck
      try {
        await execFileAsync("ffmpeg", ["-version"]);
      } catch {
        send({ type: "error", error: "FFmpeg не установлен на сервере" });
        controller.close();
        return;
      }

      // Сначала пробуем n8n
      const n8nWebhookUrl = process.env.N8N_ASSEMBLE_WEBHOOK_URL;
      if (n8nWebhookUrl) {
        try {
          send({ type: "stage", stage: "n8n", label: "Отправляю в n8n..." });
          const res = await fetchWithTimeout(
            n8nWebhookUrl,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clips: checkedClips,
                musicUrl: body.musicUrl,
                brandName: body.brandName,
                supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
                // supabaseKey intentionally omitted — n8n reads it from its own env
              }),
            },
            90_000
          );
          if (res.ok) {
            const data = await res.json();
            // Валидируем URL — n8n может вернуть незаполненный шаблон вида {{ .supabaseUrl }}
            const isRealUrl = data.videoUrl && typeof data.videoUrl === "string" && data.videoUrl.startsWith("http") && !data.videoUrl.includes("{{");
            if (isRealUrl) {
              send({ type: "done", videoUrl: data.videoUrl });
              controller.close();
              return;
            }
            // Иначе — n8n вернул шаблон или пустой URL, падаем в локальный fallback
            console.warn("[assemble] n8n returned invalid videoUrl:", data.videoUrl);
          }
        } catch (e) {
          console.warn("[assemble] n8n failed, switching to local FFmpeg:", e);
          send({ type: "stage", stage: "fallback", label: "n8n недоступен, собираю локально..." });
        }
      }

      // Fallback: локальный FFmpeg
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        send({ type: "error", error: "Storage не настроен (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
        controller.close();
        return;
      }

      const tmpDir = path.join(os.tmpdir(), `video_${Date.now()}`);

      try {
        await mkdir(tmpDir, { recursive: true });
        // Скачиваем клипы
        const clipPaths: string[] = [];
        for (let i = 0; i < checkedClips.length; i++) {
          send({
            type: "stage",
            stage: "downloading",
            label: `Скачиваю клип ${i + 1} / ${checkedClips.length}`,
            current: i + 1,
            total: checkedClips.length,
          });

          let downloaded = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetchWithTimeout(checkedClips[i], { redirect: "manual" }, 60_000);
              if (res.status >= 300 && res.status < 400) continue; // SSRF: block redirects
              if (!res.ok) continue;
              const buf = Buffer.from(await res.arrayBuffer());
              const p = path.join(tmpDir, `clip${i}.mp4`);
              await writeFile(p, buf);
              clipPaths.push(p);
              downloaded = true;
              break;
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 2_000));
            }
          }

          if (!downloaded) {
            send({ type: "clip_error", index: i, label: `Клип ${i + 1} не удалось скачать` });
          }
        }

        if (clipPaths.length === 0) {
          send({ type: "error", error: "Не удалось скачать ни один клип" });
          controller.close();
          return;
        }

        // FFmpeg — умные переходы + color grading + BPM timing
        send({ type: "stage", stage: "encoding", label: "FFmpeg: склеиваю клипы с монтажом..." });

        const rawOutput = path.join(tmpDir, "output_raw.mp4");
        const gradedOutput = path.join(tmpDir, "output_graded.mp4");
        const finalOutput = path.join(tmpDir, "output.mp4");

        const mood = body.mood ?? "Люкс";
        const sceneTypes = body.sceneTypes ?? clipPaths.map(() => "unknown" as SceneType);
        const bpm = body.bpm;
        const colorGrade = getColorGrade(mood);
        const isVertical = (body.aspectRatio ?? "9:16") === "9:16";
        const [W, H] = isVertical ? [1080, 1920] : [1920, 1080];

        if (clipPaths.length === 1) {
          await execFileAsync("ffmpeg", [
            "-y", "-i", clipPaths[0],
            "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,${colorGrade}`,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "aac", "-movflags", "+faststart", rawOutput,
          ]);
        } else {
          // Получаем длительность каждого клипа
          const durations: number[] = [];
          for (const clipPath of clipPaths) {
            try {
              const { stdout } = await execFileAsync("ffprobe", [
                "-v", "quiet", "-print_format", "json", "-show_streams", clipPath,
              ]);
              const info = JSON.parse(stdout);
              const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
              const dur = parseFloat(videoStream?.duration ?? "5");
              durations.push(bpm ? snapToBeat(dur, bpm) : dur);
            } catch {
              durations.push(5);
            }
          }

          const inputs = clipPaths.map((p) => ["-i", p]).flat();

          // Scale + color grade каждый клип
          const scaleFilters = clipPaths.map((_, i) =>
            `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,${colorGrade}[v${i}]`
          );

          // Умные переходы между сценами
          let filterChain = scaleFilters.join("; ");
          let offset = 0;
          let prevLabel = "v0";

          for (let i = 1; i < clipPaths.length; i++) {
            const { type: rawTransType, duration: transDur } = getTransition(
              sceneTypes[i - 1] ?? "unknown",
              sceneTypes[i] ?? "unknown",
              mood
            );
            // getSafeTransition гарантирует что transition реально существует в этом FFmpeg
            const transType = getSafeTransition(rawTransType, "dissolve");
            offset += durations[i - 1] - transDur;
            const outLabel = i < clipPaths.length - 1 ? `xf${i}` : "vout";
            filterChain += `; [${prevLabel}][v${i}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(3)}[${outLabel}]`;
            prevLabel = outLabel;
          }

          await execFileAsync("ffmpeg", [
            "-y", ...inputs,
            "-filter_complex", filterChain,
            "-map", "[vout]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-an", "-movflags", "+faststart", rawOutput,
          ], { maxBuffer: 100 * 1024 * 1024 });
        }

        // Аудио микширование: голос + музыка (duck) или только музыка
        const hasMusic = !!body.musicUrl;
        const hasVoice = !!body.voiceoverUrl;

        if (hasMusic || hasVoice) {
          send({ type: "stage", stage: "audio", label: "Добавляю аудио..." });
          try {
            let musicPath: string | null = null;
            let voicePath: string | null = null;

            if (hasMusic) {
              const musicRes = await fetchWithTimeout(body.musicUrl!, { redirect: "manual" }, 30_000);
              if (musicRes.ok && musicRes.status < 300) {
                musicPath = path.join(tmpDir, "music.mp3");
                await writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer()));
              }
            }

            if (hasVoice) {
              const voiceRes = await fetchWithTimeout(body.voiceoverUrl!, { redirect: "manual" }, 30_000);
              if (voiceRes.ok && voiceRes.status < 300) {
                voicePath = path.join(tmpDir, "voice.mp3");
                await writeFile(voicePath, Buffer.from(await voiceRes.arrayBuffer()));
              }
            }

            if (voicePath && musicPath) {
              await execFileAsync("ffmpeg", [
                "-y", "-i", rawOutput, "-i", voicePath, "-i", musicPath,
                "-filter_complex", "[1:a]volume=1.0[voice];[2:a]volume=0.25[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=1[audio]",
                "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-shortest",
                finalOutput,
              ]);
            } else if (voicePath) {
              await execFileAsync("ffmpeg", [
                "-y", "-i", rawOutput, "-i", voicePath,
                "-c:v", "copy", "-c:a", "aac", "-shortest", finalOutput,
              ]);
            } else if (musicPath) {
              await execFileAsync("ffmpeg", [
                "-y", "-i", rawOutput, "-i", musicPath,
                "-c:v", "copy", "-c:a", "aac", "-shortest", finalOutput,
              ]);
            } else {
              await execFileAsync("cp", [rawOutput, finalOutput]);
            }
          } catch {
            await execFileAsync("cp", [rawOutput, finalOutput]);
          }
        } else {
          await execFileAsync("cp", [rawOutput, finalOutput]);
        }

        // BUG-025: проверяем что rawOutput существует перед чтением
        if (!existsSync(rawOutput)) {
          send({ type: "error", error: "FFmpeg не создал выходной файл" });
          controller.close();
          return;
        }

        // Субтитры: если запрошены — вжигаем ASS overlay в rawOutput → gradedOutput
        if (body.subtitles && body.subtitleScript && body.subtitleScript.length > 0) {
          try {
            const assContent = generateASSSubtitles(body.subtitleScript, isVertical);
            const assPath = path.join(tmpDir, "subs.ass");
            await writeFile(assPath, assContent, "utf-8");
            const escapedAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
            await execFileAsync("ffmpeg", [
              "-y", "-i", rawOutput,
              "-vf", `ass=${escapedAssPath}`,
              "-c:v", "libx264", "-preset", "fast", "-crf", "20",
              "-c:a", "copy", "-movflags", "+faststart", gradedOutput,
            ]);
            // Заменяем rawOutput на gradedOutput для дальнейшей обработки
            await execFileAsync("cp", [gradedOutput, rawOutput]);
          } catch (e) {
            console.warn("[assemble] subtitles overlay failed, skipping:", e);
          }
        }

        // Загружаем в Supabase
        send({ type: "stage", stage: "uploading", label: "Загружаю в облако..." });
        const { readFile } = await import("fs/promises");
        const videoBuffer = await readFile(finalOutput);
        const safeName = body.brandName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 30);
        const key = `assembled/${safeName}-${Date.now()}.mp4`;

        const uploadRes = await fetchWithTimeout(
          `${supabaseUrl}/storage/v1/object/videos/${key}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "video/mp4",
            },
            body: videoBuffer,
          },
          120_000
        );

        if (!uploadRes.ok) {
          send({ type: "error", error: "Не удалось загрузить видео" });
          controller.close();
          return;
        }

        const videoUrl = `${supabaseUrl}/storage/v1/object/public/videos/${key}`;
        send({ type: "done", videoUrl });
      } catch (e) {
        send({
          type: "error",
          error: e instanceof Error ? e.message : "Ошибка сборки",
        });
      } finally {
        rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
