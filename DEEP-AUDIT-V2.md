# DEEP-AUDIT-V2 — AI Video Factory / clipgen.ru
> Дата: 11 апреля 2026 | Аудиторы: bug-hunter × reviewer (CTO/opus) | Архитектор × opus | devops-video × reviewer (FFmpeg/opus) | PM × CTO (opus)

---

## 1. Executive Summary

Сервис технически работает, но **не готов к публичному деплою** по 4 причинам: (1) двойные списания fal.ai без идемпотентности, (2) все @Image2-6 теги — мёртвые строки (только 1 картинка уходит в Atlas), (3) FFmpeg использует несуществующие фильтры `hblur`/`vibrance` и падает на реальных видео, (4) нет auth — любой запрос сжигает бюджет. Критический путь к MVP: **1 день P0-фиксов → 5 дней качества+надёжности+auth → деплой whitelist 20 человек**. Монетизацию ввести до публичного запуска, не после.

---

## 2. Критические баги — готовый код исправлений

### [CRIT-I] Идемпотентность video generation — ДЕНЬГИ
**Файл:** `src/app/api/generate/video/route.ts`
**Проблема:** Двойной клик в UI = 2 batch submit в fal.ai = двойная списуемость. Нет idempotency key.

```typescript
// В начале файла добавить:
const idempotencyCache = new Map<string, { result: unknown; ts: number }>();
const IDEMP_TTL_MS = 10 * 60 * 1000;

// В POST handler, после parse body:
const idempotencyKey = req.headers.get("X-Idempotency-Key") ?? body.idempotencyKey;
if (idempotencyKey) {
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached && Date.now() - cached.ts < IDEMP_TTL_MS) {
    return NextResponse.json(cached.result);
  }
}
// ... основная логика ...
// В конце, перед return:
if (idempotencyKey) {
  idempotencyCache.set(idempotencyKey, { result: finalResult, ts: Date.now() });
  // Очищать старые записи
  for (const [k, v] of idempotencyCache) {
    if (Date.now() - v.ts > IDEMP_TTL_MS) idempotencyCache.delete(k);
  }
}
```

### [CRIT-A] SSRF через redirect в assemble
**Файл:** `src/app/api/generate/assemble/route.ts:211`
**Проблема:** `isSafeClipUrl` проверяет хост, но `fetch` следует редиректам. `https://fal.media/redirect?to=http://169.254.169.254/` → AWS metadata.

```typescript
// Заменить fetch клипов на:
const res = await fetchWithTimeout(clipUrl, { redirect: "manual" }, 60_000);
if (res.status >= 300 && res.status < 400) {
  console.warn(`[assemble] clip ${i} redirected, rejecting`);
  continue;
}
```

### [CRIT-J] Leak API ключей в error messages
**Файл:** `src/app/api/generate/video/route.ts:125` (и аналогично в других route.ts)
**Проблема:** `res.text()` с ошибкой Atlas содержит ключ. Ошибка уходит клиенту в JSON.

```typescript
// Добавить в src/lib/error-sanitize.ts (новый файл):
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ak_[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[a-zA-Z0-9_.-]+/gi,
  /Key\s+[a-zA-Z0-9_-]+/gi,
  /[a-f0-9]{40,}/g,
];
export function sanitizeError(msg: string): string {
  let out = msg;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out.slice(0, 500);
}

// В video/route.ts заменить:
throw new Error(`Atlas submit failed (${res.status}): ${sanitizeError(err)}`);
```

### [CRIT-L] enable_safety_checker: false — Legal
**Файл:** `src/app/api/generate/frames/route.ts:272`
```typescript
// Убрать строку:
enable_safety_checker: false,  // <-- удалить
```

### [BUG-001] submitFal без таймаута
**Файл:** `src/app/api/generate/video/route.ts:159` (submitFal)
**Проблема:** Если fal.ai завис — worker висит 180 сек, блокируя весь пул.

```typescript
// Строка ~159 — заменить голый fetch на fetchWithTimeout:
res = await fetchWithTimeout(modelUrl, {
  method: "POST",
  headers: { Authorization: `Key ${falKey ?? ""}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, image_url: imageUrl, duration, aspect_ratio: aspectRatio, cfg_scale: 0.5 }),
}, 30_000);
```

### [BUG-013] Supabase без таймаута — SPOF
**Файл:** `src/lib/user-keys.ts:62-87`
**Проблема:** При Supabase outage все API routes висят на весь maxDuration.

```typescript
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function getUserApiKey(service: string): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );
    const userRes = await withTimeout(supabase.auth.getUser(), 3_000, "supabase.auth");
    const user = userRes.data.user;
    if (!user) return null;
    const { data } = await withTimeout(
      supabase.from("user_api_keys").select("encrypted_key")
        .eq("user_id", user.id).eq("service", service).single(),
      3_000, "supabase.select"
    );
    if (!data?.encrypted_key) return null;
    return decryptKey(data.encrypted_key);
  } catch (e) {
    console.warn(`[user-keys] ${service} lookup failed, falling back to env:`, e);
    return null;
  }
}
```

### [CRIT-E] resolveApiKey cache — производительность -50%
**Файл:** `src/lib/user-keys.ts`
**Проблема:** 6 сцен × 3 retry = до 54 Supabase запросов на 1 API call.

```typescript
// Добавить простой request-level cache через closure:
export function createKeyResolver() {
  const cache = new Map<string, Promise<string | undefined>>();
  return async function resolveOnce(service: string, envKey: string | undefined): Promise<string | undefined> {
    if (cache.has(service)) return cache.get(service)!;
    const p = resolveApiKey(service, envKey);
    cache.set(service, p);
    return p;
  };
}

// В handler (video/route.ts, frames/route.ts) в начале:
const resolve = createKeyResolver();
const falKey = await resolve("fal", process.env.FAL_API_KEY);
// Все последующие resolve("fal", ...) вернут кэш
```

### [CRIT-F] Zod validation на всех POST
**Файл:** `src/app/api/generate/video/route.ts` (и аналогично assemble/route.ts)

```typescript
import { z } from "zod";

const VideoInputSchema = z.object({
  script: z.array(z.object({
    sceneNumber: z.number().int().min(1),
    visualPrompt: z.string().min(10).max(2000),
    description: z.string().max(2000).default(""),
    cameraMovement: z.string().max(500).default(""),
    duration: z.string().max(20),
  })).min(1).max(10),
  keyframes: z.array(z.string().url()).max(10),
  mood: z.string().max(50),
  brandName: z.string().max(100).optional(),
  aspectRatio: z.enum(["9:16", "16:9"]).optional(),
  brandImages: z.array(z.string().url()).max(6).optional(),
  model: z.string().max(50).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

// В POST handler заменить `const body = await req.json()` на:
let body: z.infer<typeof VideoInputSchema>;
try {
  const raw = await req.json();
  body = VideoInputSchema.parse(raw);
} catch (e) {
  return NextResponse.json(
    { error: "Invalid request", details: e instanceof z.ZodError ? e.issues : String(e) },
    { status: 400 }
  );
}
```

### [BUG-005/006] Таймауты в ai-router
**Файл:** `src/lib/ai-router.ts:69, 248, 286`
**Проблема:** callClaude, callGemini, callGroq — без AbortSignal.

```typescript
// В callGemini (~строка 248) добавить в fetch:
signal: AbortSignal.timeout(30_000),

// В callGroq (~строка 286) добавить:
signal: AbortSignal.timeout(25_000),

// В callClaude (~строка 69) — это dead code (нигде не вызывается в aiCall),
// но добавить сигнал или удалить функцию целиком
```

### [BUG-002] Streaming upload Supabase (OOM при concurrent)
**Файл:** `src/app/api/generate/assemble/route.ts:362`
**Проблема:** `readFile` читает 200МБ файл в RAM. 5 пользователей одновременно = OOM.

```typescript
import { Readable } from "stream";
import { stat } from "fs/promises";
import { createReadStream } from "fs";

// Заменить readFile + upload на:
const { size } = await stat(finalOutput);
const nodeStream = createReadStream(finalOutput);
const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

const uploadRes = await fetchWithTimeout(
  `${supabaseUrl}/storage/v1/object/videos/${key}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
    },
    body: webStream,
    // @ts-expect-error — undici требует duplex для стриминга
    duplex: "half",
  },
  300_000
);
```

### [BUG-003] AbortSignal в SSE polling (клиент закрыл вкладку)
**Файл:** `src/app/api/generate/frames/route.ts:147, 213`

```typescript
// В polling loops добавить проверку signal:
for (let attempt = 0; attempt < 30; attempt++) {
  if (req.signal.aborted) {
    console.log("[frames] client disconnected, stopping poll");
    return null;
  }
  const status = await fetchWithTimeout(pollUrl, { signal: req.signal }, 15_000);
  // ...
  await new Promise(r => setTimeout(r, 3000));
}
```

### [CRIT-C] streamClosed flag в assemble (double-close exception)
**Файл:** `src/app/api/generate/assemble/route.ts:125-129`

```typescript
// Добавить в начало stream.start():
let streamClosed = false;
const send = (data: object) => {
  if (streamClosed) return;
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch { streamClosed = true; }
};

// В finally:
if (!streamClosed) {
  try { controller.close(); } catch {}
  streamClosed = true;
}
```

### [BUG-010] Race condition в StepVideo tick
**Файл:** `src/components/wizard/StepVideo.tsx:278`

```typescript
const isTickRunning = useRef(false);
const tick = useCallback(async () => {
  if (isTickRunning.current) return;
  isTickRunning.current = true;
  try {
    // ... существующая логика ...
  } finally {
    isTickRunning.current = false;
  }
}, [/* deps */]);
```

### [BUG-012 + CRIT-K] maxBuffer и -nostdin на ffmpeg
**Файл:** `src/app/api/generate/assemble/route.ts`

```typescript
// Добавить -nostdin первым аргументом и maxBuffer ВЕЗДЕ где есть execFileAsync("ffmpeg"):
await execFileAsync("ffmpeg", [
  "-nostdin",  // <-- добавить везде
  // ... остальные аргументы
], { maxBuffer: 200 * 1024 * 1024 });
```

### [CRIT-K] Hard cap расходов fal.ai
**Файл:** новый файл `src/lib/spend-limiter.ts`

```typescript
const spendMap = new Map<string, { amount: number; reset: number }>();
const DAILY_CAP_USD = 5;

export function checkSpendCap(userId: string, estimatedCost: number): boolean {
  const now = Date.now();
  const entry = spendMap.get(userId);
  if (!entry || now > entry.reset) {
    spendMap.set(userId, { amount: 0, reset: now + 86_400_000 });
  }
  const current = spendMap.get(userId)!;
  if (current.amount + estimatedCost > DAILY_CAP_USD) return false;
  current.amount += estimatedCost;
  return true;
}
```

---

## 3. Практики из курса → изменения в коде

### [P0] Multi-image payload в Atlas — ГЛАВНАЯ ФИЧА КАЧЕСТВА
**Файл:** `src/app/api/generate/video/route.ts:123-130`
**Проблема:** Сейчас отправляется только `image_url: imageUrl`. Все @Image2-6 в промте — мёртвые теги.
**Из курса:** Егор загружает 6 изображений одновременно, Seedance 2.0 маппит @ImageN по порядку.

```typescript
// В submitAtlas() — заменить body:
body: JSON.stringify({
  model: "bytedance/seedance-2.0/image-to-video",
  prompt,
  image_url: imageUrl,           // первый кадр (keyframe сцены)
  image_urls: brandImages        // все 6 бренд-ассетов
    .filter(Boolean)
    .slice(0, 6),
  quality: "pro",                // ОБЯЗАТЕЛЬНО — Fast даёт плохое качество
  duration: parseInt(duration) || 5,
  aspect_ratio: aspectRatio,
  guidance_scale: 7.5,           // добавить если Atlas поддерживает
  seed: Math.floor(Math.random() * 1_000_000), // для retry consistency
  ...(body.videoReferenceUrl ? { reference_video_url: body.videoReferenceUrl } : {}),
}),
```

> **ВАЖНО:** Перед деплоем свериться с актуальной Atlas Cloud docs — точные имена полей (`image_urls` / `reference_images` / `input_images`) могут отличаться. Проверить с реальным API ключом.

### [P0] Нормализация @Image тегов
**Файл:** `src/app/api/generate/video/route.ts:56`
**Из курса:** LLM-сценарист иногда пишет `@image1` или `@ Image 1` — Seedance не распознаёт.

```typescript
function normalizeImageTags(p: string): string {
  return p.replace(/@\s*image\s*([1-6])/gi, "@Image$1");
}

// В submitScene() перед buildPrompt:
const prompt = normalizeImageTags(buildPrompt(scene.visualPrompt, brandImages));
```

### [P0] buildPrompt — только маркеры, без описательных префиксов
**Файл:** `src/app/api/generate/video/route.ts:56-70`
**Из курса:** Seedance маппит @ImageN по порядку тега, а не по описанию роли. Префиксы «@Image1 is the main subject» засоряют первые токены.

```typescript
function buildPrompt(visualPrompt: string, brandImages: string[]): string {
  const text = normalizeImageTags(visualPrompt.trim());
  if (brandImages.length === 0) return text;
  // Если сценарист уже вставил теги — не трогаем
  if (/@Image[1-6]/.test(text)) return text;
  // Только маркеры в начале, без описаний ролей
  const markers = brandImages
    .filter(Boolean)
    .map((_, i) => `@Image${i + 1}`)
    .join(" ");
  return `${markers} ${text}`;
}
```

### [P0] Запрет fallback на fal.ai для 15-single
**Файл:** `src/app/api/generate/video/route.ts:229`
**Из курса:** fal.ai не поддерживает 15 сек. 15-single без Seedance 2.0 = промт под 3 фазы, клип 10 сек = структура ломается.

```typescript
// В submitScene() перед выбором провайдера:
const durationNum = parseFloat(scene.duration) || 5;
const is15Single = durationNum === 15;
const useAtlas = atlasKey && !is15Single ? true : !!atlasKey;

if (is15Single && !atlasKey) {
  throw new Error(
    `15-секундный single-shot требует Seedance 2.0 (Atlas Cloud). ` +
    `FAL fallback не поддерживает длительность 15 сек. Проверьте ATLAS_API_KEY.`
  );
}
```

### [P0] Retry 3 попытки для Atlas
**Файл:** `src/app/api/generate/video/route.ts:submitAtlas`
**Из курса:** "2-3 попытки норма, не баг". Сейчас нет retry.

```typescript
async function submitAtlas(/* ... */) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchWithTimeout(atlasUrl, { /* ... */ }, 35_000);
      if (res.ok) return await res.json();
      const errText = sanitizeError(await res.text());
      if (attempt === 3) throw new Error(`Atlas submit failed after 3 attempts (${res.status}): ${errText}`);
      console.warn(`[Atlas] attempt ${attempt} failed ${res.status}, retrying...`);
      await new Promise(r => setTimeout(r, attempt * 1500));
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}
```

### [P1] Anti-correction hints в system prompt
**Файл:** `src/app/api/generate/script/route.ts:42` (конец SYSTEM_PROMPT)

```typescript
// Добавить в SYSTEM_PROMPT перед ## OUTPUT FORMAT:
## ANTI-CORRECTION HINTS
When @Image references contain unusual features (custom eye color, tattoos, brand-specific text, logos):
ALWAYS add explicit preservation cues to visualPrompt:
- "preserve exact white eye color of @Image1, do not correct to natural tone"
- "keep all @Image1 tattoos visible and unchanged"
- "@Image4 logo text must remain fully legible, do not redesign"
- "@Image2 uniform graphics exactly as shown, do not mirror or redraw"
Seedance 2.0 tends to "fix" unusual features — prevent this explicitly.
```

### [P1] Финальная сцена должна содержать @Image4 (лого)
**Файл:** `src/app/api/generate/script/route.ts:20-38` (validateScriptQuality)

```typescript
// Добавить в validateScriptQuality():
const last = scenes[scenes.length - 1];
if (last && !/@Image4|logo|brand\s*mark|logotype/i.test(last.visualPrompt)) {
  issues.push(
    `Last scene must contain brand logo (@Image4) per montage bible. ` +
    `Add "@Image4 logo held on screen 2 seconds" to last visualPrompt.`
  );
}
```

### [P2] @Image5 и @Image6 в buildPrompt
**Файл:** `src/app/api/generate/video/route.ts:56-70`
**Проблема:** Только @Image1-4 поддерживались. brandImages[4] и [5] игнорировались.

```typescript
// buildPrompt уже исправлен выше через markers = brandImages.map((_, i) => `@Image${i+1}`)
// Дополнительно в script/route.ts системный промт обновить:
// @Image5 = additional product item / secondary product
// @Image6 = partner logo / secondary brand mark
```

### [P2] Few-shot: @Image2/@Image3 разные ракурсы
**Файл:** `src/app/api/generate/script/route.ts:162`

```json
{
  "sceneNumber": 3,
  "duration": "8 sec",
  "description": "Player reveals both sides of uniform",
  "descriptionRu": "Игрок разворачивается, показывая форму спереди и сзади",
  "visualPrompt": "@Image1 slow 180° spin on reflective court, warm gold rim light. 0-4s: @Image2 front of uniform faces camera, logo catches light, preserve exact uniform graphics. 4-8s: body rotates away, @Image3 back of uniform with player number revealed, same side light preserved. Slow orbit camera matches body rotation. Do not mirror or redraw graphics. EXITS player centered, back to camera.",
  "cameraMovement": "slow orbit following body rotation",
  "sceneType": "face"
}
```

---

## 4. Новые переходы — финальный код getTransition() V2

Вставить в `src/app/api/generate/assemble/route.ts` вместо существующих функций `getColorGrade`, `getTransition`, `snapToBeat`.

> **Проверка xfade (vf_xfade.c):** все переходы ниже реально существуют в FFmpeg. `vibrance` — НЕ filter FFmpeg, удалён. `hblur` как xfade требует FFmpeg ≥5.1, не используется в основных путях.

```typescript
type SceneType = "nature" | "product" | "face" | "action" | "logo" | "unknown";
type BeatStrength = "strong" | "weak" | "offbeat";
type ScenePosition = "intro" | "middle" | "climax" | "outro";

interface TransitionResult {
  type: string;
  duration: number;
}

interface ClipColorProfile {
  y: number; // luma 0..255
  u: number; // chroma
  v: number; // chroma
}

// ── Color grading ────────────────────────────────────────────────────────────
// ВАЖНО: curves — ОДИН фильтр, параметры через ":", NOT через запятую.
// vibrance НЕ существует в FFmpeg — используем eq+colorbalance.
function getColorGrade(mood: string): string {
  switch (mood) {
    case "Люкс":
      return [
        "curves=r='0/0 0.3/0.25 0.7/0.72 1/1':g='0/0 0.3/0.28 0.7/0.70 1/0.95':b='0/0 0.3/0.22 0.7/0.65 1/0.88'",
        "colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.05:bm=-0.05:rh=0.05:bh=-0.03",
        "eq=saturation=1.08:contrast=1.12:gamma=0.98",
        "vignette=PI/5",
        "noise=alls=4:allf=t",
      ].join(",");
    case "Энергия":
      return [
        "curves=r='0/0 0.3/0.32 0.7/0.75 1/1':g='0/0 0.3/0.30 0.7/0.73 1/1':b='0/0 0.3/0.33 0.7/0.78 1/1'",
        "colorbalance=rs=-0.05:bs=0.08",
        "eq=contrast=1.18:saturation=1.28:gamma=0.97",
      ].join(",");
    case "Мягко и натурально":
      return [
        "curves=r='0/0.05 0.5/0.52 1/0.95':g='0/0.03 0.5/0.50 1/0.93':b='0/0.02 0.5/0.47 1/0.88'",
        "colorbalance=rs=0.04:bs=-0.06:rm=0.03:bm=-0.03",
        "eq=saturation=0.82:gamma=1.08:contrast=0.96",
      ].join(",");
    case "Дерзко":
      return [
        "curves=r='0/0 0.4/0.38 0.7/0.78 1/1':g='0/0 0.4/0.35 0.7/0.72 1/0.97':b='0/0.05 0.4/0.42 0.7/0.76 1/1'",
        "colorbalance=rs=0.06:bs=0.04:rh=0.08:bh=-0.04",
        "eq=contrast=1.28:saturation=1.02:gamma=0.94",
        "vignette=PI/4",
      ].join(",");
    case "Минимализм":
      return [
        "curves=r='0/0 1/0.97':g='0/0 1/0.98':b='0/0.02 1/1'",
        "eq=saturation=0.38:gamma=1.10:contrast=1.06",
      ].join(",");
    case "Игриво":
      return [
        "curves=r='0/0 0.5/0.55 1/1':g='0/0 0.5/0.51 1/1':b='0/0 0.5/0.45 1/0.92'",
        "colorbalance=rs=0.05:gs=0.03:bs=-0.04",
        "eq=saturation=1.35:brightness=0.02:contrast=1.05",
      ].join(",");
    default:
      return "curves=r='0/0 0.5/0.51 1/1':g='0/0 0.5/0.50 1/1':b='0/0 0.5/0.49 1/0.98',eq=saturation=1.02";
  }
}

// ── Анализ цвета клипа через ffprobe ────────────────────────────────────────
async function analyzeClipColor(
  clipPath: string,
  tmpDir: string,
  index: number
): Promise<ClipColorProfile | null> {
  try {
    const thumbPath = path.join(tmpDir, `probe_${index}.png`);
    await execFileAsync("ffmpeg", [
      "-nostdin", "-y", "-ss", "1", "-i", clipPath,
      "-vframes", "1", "-vf", "scale=32:32", thumbPath,
    ], { maxBuffer: 10 * 1024 * 1024 });

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-f", "lavfi",
      "-i", `movie=${thumbPath},signalstats`,
      "-show_entries", "frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.UAVG,lavfi.signalstats.VAVG",
      "-of", "json",
    ], { maxBuffer: 10 * 1024 * 1024 });

    const parsed = JSON.parse(stdout);
    const tags = parsed?.frames?.[0]?.tags;
    if (!tags) return null;
    return {
      y: parseFloat(tags["lavfi.signalstats.YAVG"] ?? "128"),
      u: parseFloat(tags["lavfi.signalstats.UAVG"] ?? "128"),
      v: parseFloat(tags["lavfi.signalstats.VAVG"] ?? "128"),
    };
  } catch {
    return null;
  }
}

function colorDistance(a: ClipColorProfile, b: ClipColorProfile): number {
  const dy = (a.y - b.y) * 1.5;
  const du = a.u - b.u;
  const dv = a.v - b.v;
  return Math.sqrt(dy * dy + du * du + dv * dv);
}

function isMatchCutCandidate(a: ClipColorProfile | null, b: ClipColorProfile | null): boolean {
  if (!a || !b) return false;
  return colorDistance(a, b) < 18;
}

// ── BPM utils ────────────────────────────────────────────────────────────────
function getBeatStrength(clipIndex: number, totalClips: number, bpm: number | undefined): BeatStrength {
  if (!bpm || bpm < 40 || bpm > 220) return "weak";
  if (clipIndex === 0 || clipIndex === totalClips - 1) return "strong";
  if (clipIndex % 4 === 0) return "strong";
  if (clipIndex % 2 === 0) return "weak";
  return "offbeat";
}

function getScenePosition(clipIndex: number, totalClips: number): ScenePosition {
  if (clipIndex === 0) return "intro";
  if (clipIndex === totalClips - 1) return "outro";
  const climaxStart = Math.floor(totalClips * 0.65);
  const climaxEnd = Math.floor(totalClips * 0.85);
  if (clipIndex >= climaxStart && clipIndex <= climaxEnd) return "climax";
  return "middle";
}

function snapToBeat(duration: number, bpm: number): number {
  if (!bpm || bpm < 40 || bpm > 220) return duration;
  const beatDuration = 60 / bpm;
  const beats = Math.round(duration / beatDuration);
  return Math.max(beats, 2) * beatDuration;
}

// ── Расширенная матрица переходов V2 ────────────────────────────────────────
function getTransition(
  fromType: SceneType,
  toType: SceneType,
  mood: string,
  scenePosition: ScenePosition = "middle",
  beatStrength: BeatStrength = "weak",
  colorMatch = false
): TransitionResult {
  if (toType === "logo") {
    return mood === "Минимализм"
      ? { type: "fadewhite", duration: 1.0 }
      : { type: "fadeblack", duration: 0.9 };
  }

  if (colorMatch) {
    return { type: "dissolve", duration: 0.08 };
  }

  if (scenePosition === "climax" && beatStrength === "strong") {
    const climaxMap: Record<string, TransitionResult> = {
      "Энергия":            { type: "wipeleft",    duration: 0.18 },
      "Дерзко":             { type: "pixelize",    duration: 0.22 },
      "Игриво":             { type: "slideup",     duration: 0.22 },
      "Люкс":               { type: "fadewhite",   duration: 0.35 },
      "Минимализм":         { type: "fadeblack",   duration: 0.30 },
      "Мягко и натурально": { type: "dissolve",    duration: 0.50 },
    };
    return climaxMap[mood] ?? { type: "wipeleft", duration: 0.20 };
  }

  if (scenePosition === "intro") {
    const introMap: Record<string, TransitionResult> = {
      "Люкс":               { type: "fadeblack",  duration: 1.20 },
      "Мягко и натурально": { type: "dissolve",   duration: 1.40 },
      "Минимализм":         { type: "fadewhite",  duration: 1.00 },
      "Энергия":            { type: "smoothleft", duration: 0.60 },
      "Дерзко":             { type: "circleopen", duration: 0.70 },
      "Игриво":             { type: "zoomin",     duration: 0.80 },
    };
    return introMap[mood] ?? { type: "dissolve", duration: 1.00 };
  }

  if (scenePosition === "outro") {
    const outroMap: Record<string, TransitionResult> = {
      "Люкс":               { type: "fadeblack",   duration: 1.10 },
      "Мягко и натурально": { type: "dissolve",    duration: 1.30 },
      "Минимализм":         { type: "fadewhite",   duration: 1.20 },
      "Энергия":            { type: "fadeblack",   duration: 0.70 },
      "Дерзко":             { type: "circleclose", duration: 0.90 },
      "Игриво":             { type: "squeezev",    duration: 0.70 },
    };
    return outroMap[mood] ?? { type: "fadeblack", duration: 0.90 };
  }

  if (fromType === "nature" && toType === "nature") {
    return mood === "Мягко и натурально" ? { type: "dissolve", duration: 1.20 } : { type: "dissolve", duration: 0.90 };
  }
  if (fromType === "nature" && toType === "product") {
    return mood === "Люкс" ? { type: "fadeblack", duration: 0.70 } : { type: "circleopen", duration: 0.60 };
  }
  if (fromType === "face" && toType === "product") return { type: "zoomin", duration: 0.60 };
  if (fromType === "product" && toType === "face") {
    return mood === "Мягко и натурально" ? { type: "dissolve", duration: 0.90 } : { type: "smoothright", duration: 0.50 };
  }
  if (fromType === "action") {
    return beatStrength === "strong" ? { type: "horzopen", duration: 0.25 } : { type: "slideleft", duration: 0.35 };
  }
  if (toType === "action") return { type: "wipeleft", duration: 0.22 };
  if (fromType === "product" && toType === "product") {
    return mood === "Минимализм" ? { type: "wipeleft", duration: 0.45 } : { type: "slideleft", duration: 0.50 };
  }
  if (fromType === "face" && toType === "face") return { type: "dissolve", duration: 0.80 };

  const moodMatrix: Record<string, Record<BeatStrength, TransitionResult>> = {
    "Люкс":               { strong: { type: "fadeblack",  duration: 0.65 }, weak: { type: "dissolve",   duration: 1.00 }, offbeat: { type: "dissolve",  duration: 0.85 } },
    "Энергия":            { strong: { type: "horzopen",   duration: 0.25 }, weak: { type: "smoothleft", duration: 0.40 }, offbeat: { type: "slideleft", duration: 0.35 } },
    "Мягко и натурально": { strong: { type: "dissolve",   duration: 1.10 }, weak: { type: "dissolve",   duration: 1.30 }, offbeat: { type: "dissolve",  duration: 1.20 } },
    "Дерзко":             { strong: { type: "pixelize",   duration: 0.30 }, weak: { type: "horzopen",   duration: 0.35 }, offbeat: { type: "diagtl",    duration: 0.30 } },
    "Минимализм":         { strong: { type: "wipeleft",   duration: 0.50 }, weak: { type: "fadeblack",  duration: 0.70 }, offbeat: { type: "fadewhite", duration: 0.60 } },
    "Игриво":             { strong: { type: "slideup",    duration: 0.35 }, weak: { type: "squeezeh",   duration: 0.40 }, offbeat: { type: "zoomin",    duration: 0.45 } },
  };
  return moodMatrix[mood]?.[beatStrength] ?? { type: "dissolve", duration: 0.70 };
}

// ── LUFS normalization + audio ducking ───────────────────────────────────────
// Заменить существующий amix блок на:
function buildAudioFilter(hasVoice: boolean, hasMusic: boolean): string | null {
  if (hasVoice && hasMusic) {
    return [
      "[1:a]volume=1.0,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[voice]",
      "[2:a]volume=0.35,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[musicraw]",
      "[musicraw][voice]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[ducked]",
      "[voice][ducked]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-14:LRA=11:TP=-1.5[audio]",
    ].join(";");
  }
  if (hasVoice) return "[1:a]volume=1.0,loudnorm=I=-14:LRA=11:TP=-1.5[audio]";
  if (hasMusic) return "[1:a]volume=0.9,loudnorm=I=-14:LRA=11:TP=-1.5[audio]";
  return null;
}

// ── Исправление цикла построения filter_complex (накопительный offset) ───────
// Заменить существующий цикл переходов на:
/*
let filterChain = scaleFilters.join("; ");
let prevLabel = "v0";
let accumulatedDuration = durations[0];

const colorProfiles: (ClipColorProfile | null)[] = [];
for (let i = 0; i < clipPaths.length; i++) {
  colorProfiles.push(await analyzeClipColor(clipPaths[i], tmpDir, i));
}

for (let i = 1; i < clipPaths.length; i++) {
  const scenePosition = getScenePosition(i, clipPaths.length);
  const beatStrength = getBeatStrength(i, clipPaths.length, bpm);
  const colorMatch = isMatchCutCandidate(colorProfiles[i - 1], colorProfiles[i]);
  const { type: transType, duration: transDur } = getTransition(
    sceneTypes[i - 1] ?? "unknown",
    sceneTypes[i] ?? "unknown",
    mood, scenePosition, beatStrength, colorMatch
  );

  const offset = accumulatedDuration - transDur;
  const outLabel = i < clipPaths.length - 1 ? `xf${i}` : "vout";
  filterChain += `; [${prevLabel}][v${i}]xfade=transition=${transType}:duration=${transDur.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`;
  prevLabel = outLabel;
  accumulatedDuration = offset + durations[i];
}
*/
```

---

## 5. Детальный план по фазам (CTO-version)

### ФАЗА 0 — Сегодня (1 день, 3 агента параллельно)

> **Важно:** FFmpeg фиксы переведены в Фазу 0 — без них сборка падает на реальных видео.

| # | Задача | Файл | Строки | Агент | Сложность | Приоритет |
|---|--------|------|--------|-------|-----------|-----------|
| 1 | CRIT-I: идемпотентность generation | video/route.ts | 72+ | bug-hunter | 3 | 5 |
| 2 | CRIT-A: SSRF redirect в assemble | assemble/route.ts | 211 | bug-hunter | 2 | 5 |
| 3 | CRIT-J: sanitize error messages | video/route.ts | 125 | bug-hunter | 2 | 5 |
| 4 | BUG-001: submitFal таймаут 30s | video/route.ts | 159 | bug-hunter | 1 | 5 |
| 5 | BUG-013: supabase таймаут 3s | user-keys.ts | 62 | bug-hunter | 2 | 5 |
| 6 | Hard cap $5/user/day + billing alert | новый spend-limiter.ts | — | bug-hunter | 2 | 5 |
| 7 | FFmpeg: hblur→horzopen | assemble/route.ts | ~63 | bug-hunter | 1 | 5 |
| 8 | FFmpeg: убрать vibrance | assemble/route.ts | ~32 | bug-hunter | 1 | 5 |
| 9 | FFmpeg: исправить синтаксис curves | assemble/route.ts | ~30-51 | bug-hunter | 1 | 5 |
| 10 | CRIT-C: streamClosed flag | assemble/route.ts | 125 | bug-hunter | 1 | 4 |
| 11 | CRIT-K: -nostdin + maxBuffer везде | assemble/route.ts | все ffmpeg | bug-hunter | 2 | 4 |

**Зависимости:** нет (все независимы, параллелить 3 агентами по 3-4 задачи)

**Риски:**
- Идемпотентность в serverless без Redis — in-memory Map не работает между инстансами (компромисс на MVP)
- Hard cap требует знать стоимость сцены заранее — использовать оценку $0.5/сцена

---

### ФАЗА 1 — Неделя 1 (3 трека параллельно)

**Трек A: Качество визуала (критичный)**

| # | Задача | Файл | Строки | Агент | Сложность | Приоритет |
|---|--------|------|--------|-------|-----------|-----------|
| 12 | Atlas multi-image payload (6 картинок) | video/route.ts | 123-130 | nextjs-dev | 3 | 5 |
| 13 | @Image нормализация + buildPrompt рефакторинг | video/route.ts | 56-70 | nextjs-dev | 2 | 5 |
| 14 | Hero collage enforced в StepBrief | StepBrief.tsx | новый gate | react-dev | 2 | 5 |
| 15 | Video reference файлом в Atlas | video/route.ts + StepVideo | 123 | nextjs-dev | 3 | 5 |
| 16 | 15-single: запретить fal fallback | video/route.ts | 229 | nextjs-dev | 1 | 4 |
| 17 | Atlas NSFW fallback на Seedream | video/route.ts | submitScene | nextjs-dev | 3 | 5 |
| 18 | Atlas retry 3 попытки | video/route.ts | submitAtlas | nextjs-dev | 2 | 4 |
| 19 | Anti-correction hints в SYSTEM_PROMPT | script/route.ts | 42 | ai-prompt-engineer | 1 | 3 |
| 20 | Few-shot @Image2/@Image3 ракурсы | script/route.ts | 162 | ai-prompt-engineer | 2 | 3 |
| 21 | Валидация @Image4 в последней сцене | script/route.ts | 20-38 | ai-prompt-engineer | 1 | 3 |

**Трек B: Надёжность**

| # | Задача | Файл | Строки | Агент | Сложность | Приоритет |
|---|--------|------|--------|-------|-----------|-----------|
| 22 | Zod validation на всех POST | все route.ts | входы | bug-hunter | 3 | 5 |
| 23 | resolveApiKey cache per-request | user-keys.ts | новая | bug-hunter | 2 | 5 |
| 24 | BUG-005/006: таймауты ai-router | ai-router.ts | 69,248,286 | bug-hunter | 1 | 4 |
| 25 | AbortSignal в SSE polling | frames/route.ts | 147,213 | bug-hunter | 2 | 4 |
| 26 | Streaming upload Supabase (OOM) | assemble/route.ts | 362 | bug-hunter | 3 | 4 |
| 27 | Auth: email-whitelist (минимум для запуска) | middleware.ts | новый | nextjs-dev | 2 | 5 |
| 28 | Watchdog: timeout для зависших jobs + UI | StepVideo + route | новый | react-dev | 3 | 4 |
| 29 | Supabase pg_dump cron backup | VPS cron | — | devops | 1 | 5 |

**Трек C: FFmpeg V2**

| # | Задача | Файл | Строки | Агент | Сложность | Приоритет |
|---|--------|------|--------|-------|-----------|-----------|
| 30 | Расширенный getTransition V2 (весь код из §4) | assemble/route.ts | getTransition | devops-video | 3 | 4 |
| 31 | analyzeClipColor + getScenePosition | assemble/route.ts | новые функции | devops-video | 3 | 3 |
| 32 | buildAudioFilter LUFS -14 + ducking | assemble/route.ts | audio блок | devops-video | 2 | 3 |
| 33 | Накопительный offset в filter_complex | assemble/route.ts | цикл переходов | devops-video | 2 | 4 |

**Зависимости Фазы 1:**
- Задача 12 (multi-image) → требует тест с реальным Atlas API ключом ПЕРЕД деплоем
- Задача 17 (NSFW fallback) → зависит от 12 (знать когда Atlas вернул NSFW error)
- Задача 27 (auth) → должна быть до любого публичного URL

---

### ФАЗА 2 — Неделя 2-3

| # | Задача | Файл | Агент | Приоритет |
|---|--------|------|-------|-----------|
| 34 | Полноценный Supabase Auth + Google OAuth | middleware.ts + (auth) | nextjs-dev | 5 |
| 35 | YooKassa интеграция (Free/Pro тиры) | api/payments/ | php-dev / nextjs-dev | 5 |
| 36 | Dashboard: мои ролики + баланс | app/dashboard/ | react-dev | 4 |
| 37 | Rate-limit (in-memory на VPS, не Redis) | rate-limit.ts | bug-hunter | 3 |
| 38 | BUG-010: race в StepVideo tick | StepVideo.tsx | react-dev | 3 |
| 39 | BUG-011: sharp compress перед Gemini | frames/route.ts | bug-hunter | 3 |
| 40 | CRIT-B: cleanup старых tmpDir | assemble/route.ts | bug-hunter | 2 |
| 41 | Health endpoint /api/health | api/health/ | nextjs-dev | 3 |
| 42 | Langfuse self-hosted (Docker на VPS) | VPS + ai-router | devops | 3 |
| 43 | TOS + Privacy + клик-врап при upload | UI | react-dev | 4 |
| 44 | Brand Kit save/load (2 нишевых шаблона) | supabase + UI | nextjs-dev | 3 |
| 45 | BUG-004: Redis rate-limit (если Vercel) | rate-limit.ts | bug-hunter | 2 |

---

### ФАЗА 3 — Месяц 2 (после первых платящих)

| # | Задача | Агент | Приоритет |
|---|--------|-------|-----------|
| 46 | Субтитры Whisper + FFmpeg (2 шрифта) | devops-video | 3 |
| 47 | ElevenLabs озвучка (1-2 голоса) | nextjs-dev | 3 |
| 48 | Мультиформат 9:16/16:9/1:1 | devops-video | 3 |
| 49 | Путь 2 "есть идея" (если PMF подтвердился) | nextjs-dev | 2 |
| 50 | Auto-анализ ассетов Gemini Vision | nextjs-dev | 2 |

**ВЫРЕЗАНО из плана (до 1000 роликов в БД):**
- RAG + pgvector + feedback loop
- Путь 3 "сделай сам"
- Семантический кэш
- 6 шаблонов ниш (начать с 2)
- Agency тир $99
- Webhook архитектура для frames
- Robokassa fallback

---

## MVP Checklist (первый деплой)

### ОБЯЗАТЕЛЬНО:
- [ ] CRIT-I идемпотентность (нет двойных списаний)
- [ ] CRIT-A SSRF фикс
- [ ] CRIT-J error sanitize
- [ ] Hard cap $5/user/day + global $30/день alert
- [ ] BUG-001 + BUG-013 таймауты
- [ ] FFmpeg: hblur/vibrance/curves фиксы (сборка не падает)
- [ ] Atlas multi-image (6 картинок передаются)
- [ ] @Image нормализация
- [ ] Email-whitelist (10-20 invited users)
- [ ] Auth (хотя бы базовый)
- [ ] Supabase pg_dump cron backup
- [ ] Health endpoint
- [ ] TOS + Privacy + disclaimer про фото людей
- [ ] .env.production вне git

### ОПЦИОНАЛЬНО (после деплоя):
- Google OAuth, YooKassa, Brand Kit, шаблоны ниш, субтитры, ElevenLabs, Dashboard

### НЕ ДЕЛАТЬ в MVP:
- RAG, pgvector, Путь 2/3, 5+ шаблонов, Agency тир, Reference-видео по URL

---

## Топ-5 рисков (не учтены в плане)

1. **Fal.ai бюджетная катастрофа** — публичный endpoint без auth = $500 за ночь от бота. Фиксы: hard cap + email-whitelist до публичного деплоя.
2. **Atlas NSFW filter на продуктовых съёмках** — зафиксировано в memory. Бутылки одеколона, губы модели = блокировка. Нужен fallback на Seedream/Flux Pro + детект NSFW-ответа.
3. **Vercel vs Beget VPS** — план противоречит сам себе: BUG-004 про Vercel multi-instance, а деплой на Beget. На одном VPS in-memory rate-limit работает, Redis не нужен. Принять решение о хостинге до Фазы 1.
4. **Юридический риск** — пользователь загрузит фото знаменитости → сгенерим рекламу → иск. Нужен TOS + клик-врап на upload + disclaimer.
5. **Зависшие jobs без выхода** — если Atlas/fal.ai зависнет на 10 минут, пользователь видит спиннер. Нужен watchdog (timeout 3 мин) + явная ошибка в UI + возврат credits.

---

*Файлы для немедленных правок:*
- [video/route.ts](src/app/api/generate/video/route.ts) — CRIT-I, CRIT-J, BUG-001, Atlas multi-image, @Image, 15-single
- [assemble/route.ts](src/app/api/generate/assemble/route.ts) — CRIT-A, CRIT-C, CRIT-K, BUG-002, FFmpeg V2
- [frames/route.ts](src/app/api/generate/frames/route.ts) — CRIT-L, BUG-003, BUG-011
- [ai-router.ts](src/lib/ai-router.ts) — BUG-005, BUG-006, CRIT-E
- [user-keys.ts](src/lib/user-keys.ts) — BUG-013
- [script/route.ts](src/app/api/generate/script/route.ts) — anti-correction hints, few-shots, validateScriptQuality
- [StepVideo.tsx](src/components/wizard/StepVideo.tsx) — BUG-010
