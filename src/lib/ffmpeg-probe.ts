/**
 * ffmpeg-probe.ts
 *
 * Запускается ОДИН РАЗ при старте сервера.
 * Проверяет какие xfade transitions реально работают на текущем FFmpeg.
 * getTransition() использует только verified список — никаких runtime ошибок.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Все transitions которые мы хотим использовать
const DESIRED_TRANSITIONS = [
  "dissolve", "fadeblack", "fadewhite",
  "horzopen", "horzclose", "vertopen", "vertclose",
  "zoomin", "slideup", "slidedown", "slideleft", "slideright",
  "circleopen", "circleclose", "circlecrop",
  "pixelize", "radial",
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "smoothleft", "smoothright", "smoothup", "smoothdown",
  "diagtl", "diagtr", "diagbl", "diagbr",
  "squeezeh", "squeezev",
  "hlslice", "hrslice", "vuslice", "vdslice",
  "coverleft", "coverright", "revealright", "revealleft",
  "fadefast", "fadeslow",
] as const;

export type XfadeTransition = typeof DESIRED_TRANSITIONS[number];

// Кэш результата проверки
let _verified: Set<string> | null = null;
let _ffmpegVersion = "unknown";

/**
 * Проверяет transition через реальный тестовый вызов FFmpeg.
 * 2 чёрных кадра + xfade → /dev/null. Если ошибка — transition не работает.
 */
async function testTransition(name: string): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", [
      "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1:r=24",
      "-f", "lavfi", "-i", "color=c=white:s=64x64:d=1:r=24",
      "-filter_complex", `[0][1]xfade=transition=${name}:duration=0.5:offset=0.5`,
      "-f", "null", "-",
    ], { timeout: 5000, maxBuffer: 512 * 1024 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Запускает проверку всех transitions параллельно.
 * Вызывать один раз при старте. Результат кэшируется в памяти.
 */
export async function probeFFmpegTransitions(): Promise<{
  verified: string[];
  failed: string[];
  ffmpegVersion: string;
}> {
  if (_verified !== null) {
    return {
      verified: [..._verified],
      failed: DESIRED_TRANSITIONS.filter(t => !_verified!.has(t)),
      ffmpegVersion: _ffmpegVersion,
    };
  }

  // Определяем версию FFmpeg
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"], { timeout: 3000 });
    const match = stdout.match(/ffmpeg version (\S+)/);
    _ffmpegVersion = match?.[1] ?? "unknown";
  } catch {
    _ffmpegVersion = "not-installed";
    _verified = new Set();
    console.error("[ffmpeg-probe] FFmpeg не найден");
    return { verified: [], failed: [...DESIRED_TRANSITIONS], ffmpegVersion: "not-installed" };
  }

  // Тестируем все transitions параллельно (батчами по 8 чтобы не перегружать)
  const results = new Map<string, boolean>();
  const batchSize = 8;

  for (let i = 0; i < DESIRED_TRANSITIONS.length; i += batchSize) {
    const batch = DESIRED_TRANSITIONS.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async t => ({ t, ok: await testTransition(t) }))
    );
    batchResults.forEach(({ t, ok }) => results.set(t, ok));
  }

  _verified = new Set([...results.entries()].filter(([, ok]) => ok).map(([t]) => t));

  const verified = [..._verified];
  const failed = DESIRED_TRANSITIONS.filter(t => !_verified!.has(t));

  if (failed.length > 0) {
    console.warn(`[ffmpeg-probe] Недоступные transitions (${failed.length}): ${failed.join(", ")}`);
  }
  console.log(`[ffmpeg-probe] FFmpeg ${_ffmpegVersion}: ${verified.length}/${DESIRED_TRANSITIONS.length} transitions OK`);

  return { verified, failed, ffmpegVersion: _ffmpegVersion };
}

/**
 * Получить безопасный transition — если желаемый недоступен, вернуть fallback.
 * Вызывать ТОЛЬКО после probeFFmpegTransitions().
 */
export function getSafeTransition(desired: string, fallback = "dissolve"): string {
  if (_verified === null) {
    // probe ещё не запускался — возвращаем dissolve (он есть везде)
    console.warn(`[ffmpeg-probe] getSafeTransition("${desired}") вызван до probe — используем dissolve`);
    return "dissolve";
  }
  if (_verified.has(desired)) return desired;
  console.warn(`[ffmpeg-probe] transition "${desired}" недоступен → fallback "${fallback}"`);
  return _verified.has(fallback) ? fallback : "dissolve";
}

/**
 * Проверить что конкретный transition существует.
 */
export function isTransitionAvailable(name: string): boolean {
  return _verified?.has(name) ?? false;
}
