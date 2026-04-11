# FINAL BUG REPORT — AI Video Factory
# Дата: 2026-04-11 | Агентов: 12 | Файлов проверено: 55+

## ИТОГО: 15 CRIT / 34 HIGH / 28 MED / 10 LOW

Отчёт составлен на основе 11 параллельных аудитов (A1–A12). Дубли схлопнуты в один баг.

---
## КРИТИЧЕСКИЕ (блокируют деплой — исправить ПЕРЕД первым пользователем)

### BUG-001 [CRIT] Root-пароль VPS в plaintext в репозитории
**Файл:** `deploy.sh:4-6`
**Суть:** `PASS="Bn2#y4K)rtUB"` + деплой через `root@155.212.141.8` — полный root-доступ утекает в git.
**Фикс:**
```bash
# deploy.sh: убрать PASS, использовать SSH-ключ
ssh -i ~/.ssh/deploy_key deploy@155.212.141.8 "cd /app && git pull && docker-compose up -d"
# + создать non-root user 'deploy' с sudo только для docker
# + git rm --cached deploy.sh, добавить в .gitignore, ротировать root-пароль VPS НЕМЕДЛЕННО
```

### BUG-002 [CRIT] StrictHostKeyChecking=no → MITM на деплое
**Файл:** `deploy.sh`
**Суть:** SSH без проверки host key — любой перехват → полный контроль над prod.
**Фикс:**
```bash
ssh-keyscan -H 155.212.141.8 >> ~/.ssh/known_hosts
# В deploy.sh убрать -o StrictHostKeyChecking=no
```

### BUG-003 [CRIT] /api/storage/upload без авторизации
**Файл:** `src/middleware.ts:10-17`
**Суть:** Роут не в PROTECTED_API_PREFIXES → любой анонимный клиент заливает произвольные файлы в публичный bucket.
**Фикс:**
```ts
const PROTECTED_API_PREFIXES = [
  "/api/generate",
  "/api/analyze",
  "/api/projects",
  "/api/enhance",
  "/api/storage",   // <— добавить
  "/api/user",
  "/api/balances",
];
```

### BUG-004 [CRIT] ENCRYPTION_KEY fallback — ключи хранятся в plaintext
**Файл:** `src/lib/user-keys.ts`
**Суть:** Если ENCRYPTION_KEY не задан, encryptKey/decryptKey падают в base64-fallback → API-ключи пользователей лежат в БД без шифрования.
**Фикс:**
```ts
const KEY = process.env.ENCRYPTION_KEY;
if (!KEY || KEY.length < 32) {
  throw new Error("ENCRYPTION_KEY must be set (>=32 chars) at boot");
}
```

### BUG-005 [CRIT] decryptKey возвращает мусор вместо null при ошибке
**Файл:** `src/lib/user-keys.ts:36-55`
**Суть:** При неверном ключе/ротации decryptKey ловит исключение и возвращает base64-ciphertext — мусорная строка уходит в API → непонятный 401.
**Фикс:**
```ts
export function decryptKey(enc: string): string | null {
  try {
    // ... decrypt
    return plain;
  } catch (e) {
    console.error("[user-keys] decrypt failed", e);
    return null; // вместо return enc
  }
}
```

### BUG-006 [CRIT] Глобальный Supabase singleton → утечка сессий между пользователями
**Файл:** `src/lib/supabase.ts:6`
**Суть:** createClient() на уровне модуля с persistSession → один серверный процесс обслуживает нескольких пользователей одним клиентом.
**Фикс:**
```ts
// Удалить src/lib/supabase.ts целиком
// Везде использовать:
//   - createServerClient() из supabase-server.ts для route handlers
//   - createBrowserClient() из supabase-browser.ts для client components
//   - createServiceClient() для admin операций
```

### BUG-007 [CRIT] Публичный bucket "assets" → IDOR на voiceover
**Файл:** Supabase Storage policy + `voiceover/route.ts:116-119`
**Суть:** Bucket public + предсказуемый path → любой скачает чужие аудио/изображения по URL.
**Фикс:**
```sql
UPDATE storage.buckets SET public = false WHERE id = 'assets';
CREATE POLICY "users read own assets" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'assets' AND (storage.foldername(name))[1] = auth.uid()::text
  );
```
+ signed URLs через createSignedUrl(path, 3600).

### BUG-008 [CRIT] voiceover: inline service_role без auth-check
**Файл:** `src/app/api/generate/voiceover/route.ts:116-119`
**Суть:** Создаёт createClient(..., SERVICE_ROLE_KEY) без проверки auth.getUser() → любой может писать в чужой проект.
**Фикс:**
```ts
const { data: { user } } = await supabaseServer.auth.getUser();
if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
```

### BUG-009 [CRIT] NSFW fallback chain — model не передаётся в submitFal
**Файл:** `src/app/api/generate/video/route.ts:276-283`
**Суть:** При NSFW-откате переменная model не пробрасывается → всегда стартует с seedance-15, fallback сломан.
**Фикс:**
```ts
for (const model of FALLBACK_CHAIN) {
  try {
    const res = await submitFal({ prompt, imageUrl, model, apiKey });
    return res;
  } catch (e) {
    if (!isNSFWError(e)) throw e;
    continue;
  }
}
```

### BUG-010 [CRIT] `let res: Response` без инициализации → ReferenceError
**Файл:** `src/app/api/generate/video/route.ts:128-149`
**Суть:** При network-ошибке в submitAtlas res остаётся undeclared → TypeError в if (!res.ok).
**Фикс:**
```ts
let res: Response | undefined;
try {
  res = await fetch(url, { /*...*/ });
} catch (e) {
  throw new Error(`Atlas network error: ${(e as Error).message}`);
}
if (!res || !res.ok) { /* ... */ }
```

### BUG-011 [CRIT] auto-assets polling 300s > maxDuration 180s
**Файл:** `src/app/api/generate/auto-assets/route.ts`
**Суть:** pollMidjourney 60×5сек=300с, Vercel killit функцию на 180с, биллинг piapi продолжается.
**Фикс:**
```ts
// Разделить на submit + status endpoint:
// POST /auto-assets → возвращает jobId сразу
// GET /auto-assets/status?id=... → читает из БД
// Polling перенести на клиент
// Сохранять task_id в БД сразу после submit
```

### BUG-012 [CRIT] SSRF в export: file:// + DNS rebinding
**Файл:** `src/app/api/generate/export/route.ts:22`
**Суть:** Схема file:// не блокируется, DNS rebinding обходит isSafeUrl.
**Фикс:**
```ts
const u = new URL(url);
if (u.protocol !== "https:") throw new Error("only https");
const ip = await dns.lookup(u.hostname);
if (isPrivateIp(ip.address)) throw new Error("private ip blocked");
const res = await fetch(u.href, {
  redirect: "manual",
  signal: AbortSignal.timeout(30_000),
});
```

### BUG-013 [CRIT] SSRF через redirect в analyze/*
**Файл:** `analyze/website/route.ts`, `asset-quality/route.ts`, `video-reference/route.ts`
**Суть:** isSafeUrl проверяет только исходный URL. После 302 на http://169.254.169.254/ уходит реальный запрос.
**Фикс:**
```ts
async function safeFetch(url: string) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    await assertPublicHttps(current);
    const r = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (r.status >= 300 && r.status < 400) {
      current = new URL(r.headers.get("location")!, current).href;
      continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
```

### BUG-014 [CRIT] rate-limit IP spoofing через X-Forwarded-For
**Файл:** `src/lib/rate-limit.ts:44-49`
**Суть:** getClientIp читает x-forwarded-for напрямую → клиент подделывает → rate-limit обходится.
**Фикс:**
```ts
function getClientIp(req: NextRequest): string {
  if (req.ip) return req.ip;
  const xff = req.headers.get("x-forwarded-for");
  if (xff && process.env.TRUST_PROXY === "1") {
    return xff.split(",")[0].trim();
  }
  return "unknown";
}
```

### BUG-015 [CRIT] script API: _meta.model отсутствует → UI рендерит undefined
**Файл:** `src/app/api/generate/script/route.ts` + `StepScript.tsx:306`
**Суть:** UI ждёт _meta.model, роут его не возвращает.
**Фикс:**
```ts
return NextResponse.json({
  ...result,
  _meta: { model: modelUsed, latencyMs: Date.now() - t0 }
});
// StepScript.tsx:306 — guard:
{script._meta?.model ?? "—"}
```

---
## ВЫСОКИЕ (исправить в течение недели)

### BUG-016 [HIGH] rate-limit in-memory Map не работает в serverless
**Файл:** `src/lib/rate-limit.ts`
**Суть:** Каждый Vercel instance имеет свою Map → лимит 10/мин превращается в 10×N/мин.
**Фикс:**
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});
const { success } = await ratelimit.limit(ip);
```

### BUG-017 [HIGH] rate-limit не применён в 10+ роутах
**Файл:** `analyze/*`, `enhance/*`, `storage/*`, `auto-assets`, `hero-collage`, `voiceover`, `export`
**Суть:** Роуты открыты для abuse — биллинг выжигается за минуты.
**Фикс:**
```ts
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, { limit: 10, window: 60 });
  if (!rl.ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });
}
```

### BUG-018 [HIGH] CSP 'unsafe-eval' + 'unsafe-inline' = XSS защита обнулена
**Файл:** `next.config.ts:15`
**Фикс:**
```ts
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{NONCE}'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
  ].join("; ")
}
```

### BUG-019 [HIGH] submitFal без AbortSignal → зависает навсегда
**Файл:** `src/app/api/generate/video/route.ts:215-225`
**Фикс:** `signal: AbortSignal.timeout(30_000)`

### BUG-020 [HIGH] keyframes[i]=undefined → Atlas 400
**Файл:** `src/app/api/generate/video/route.ts:253-257`
**Фикс:**
```ts
for (let i = 0; i < script.length; i++) {
  const imageUrl = keyframes[i];
  if (!imageUrl) {
    return NextResponse.json({ error: `missing keyframe for scene ${i}` }, { status: 400 });
  }
}
```

### BUG-021 [HIGH] Нет идемпотентности → двойной POST = двойной биллинг
**Файл:** все `generate/*` роуты
**Фикс:**
```ts
const key = req.headers.get("idempotency-key");
if (!key) return NextResponse.json({ error: "idempotency-key required" }, { status: 400 });
const existing = await db.jobs.findFirst({ where: { idempotency_key: key, user_id } });
if (existing) return NextResponse.json(existing.result);
// ... выполнить
await db.jobs.insert({ idempotency_key: key, user_id, result });
```

### BUG-022 [HIGH] SSRF в assemble: fetch клипов без redirect:manual
**Файл:** `src/app/api/generate/assemble/route.ts:263`
**Фикс:** см. BUG-013 (safeFetch).

### BUG-023 [HIGH] parse/route.ts не передаёт openrouter ключ → нет Claude fallback
**Файл:** `src/app/api/generate/script/parse/route.ts:76-84`
**Фикс:**
```ts
const keys = await resolveApiKeys(userId, ["groq", "openrouter"]);
const result = await callLLM({ system, user, groqKey: keys.groq, openrouterKey: keys.openrouter });
```

### BUG-024 [HIGH] parse/route.ts не вызывает guardScript
**Файл:** `src/app/api/generate/script/parse/route.ts:113-133`
**Суть:** Сцены без NSFW-sanitize, без @Image normalize, без @Image4.
**Фикс:**
```ts
import { guardScript } from "@/lib/pipeline-guard";
const guarded = guardScript(parsed.data, { brandImagesCount });
return NextResponse.json(guarded);
```

### BUG-025 [HIGH] assemble: rawOutput может не существовать → unhandled exception
**Файл:** `src/app/api/generate/assemble/route.ts:406-407`
**Фикс:**
```ts
if (!fs.existsSync(rawOutput) || fs.statSync(rawOutput).size === 0) {
  throw new Error(`FFmpeg produced no output. stderr: ${stderr.slice(-2000)}`);
}
await fs.promises.copyFile(rawOutput, final);
```

### BUG-026 [HIGH] voiceover mode="both" падает до генерации скрипта
**Файл:** `src/app/api/generate/voiceover/route.ts:149`
**Фикс:**
```ts
if (mode !== "both" && !script) {
  return NextResponse.json({ error: "script is required" }, { status: 400 });
}
```

### BUG-027 [HIGH] export: arrayBuffer() без Content-Length → OOM
**Файл:** `src/app/api/generate/export/route.ts`
**Фикс:**
```ts
const len = Number(res.headers.get("content-length") || "0");
if (len > 200 * 1024 * 1024) throw new Error("file too large");
// или стримить через Readable.fromWeb(res.body).pipe(fs.createWriteStream(tmp))
```

### BUG-028 [HIGH] export: FFmpeg может создать пустой output
**Файл:** `src/app/api/generate/export/route.ts`
**Фикс:**
```ts
const resultBuf = await fs.promises.readFile(outPath);
if (resultBuf.length === 0) throw new Error("ffmpeg produced empty file");
```

### BUG-029 [HIGH] hero-collage: polling 92с + submit 30с > maxDuration 120с
**Файл:** `src/app/api/generate/hero-collage/route.ts`
**Фикс:** async job (jobId → status endpoint), либо уменьшить poll budget до 60с.

### BUG-030 [HIGH] pollRecraft: финальный fetch без таймаута
**Файл:** `src/app/api/generate/auto-assets/route.ts`
**Фикс:** `signal: AbortSignal.timeout(15_000)` на всех fetch.

### BUG-031 [HIGH] storage/upload: path traversal через "....//"
**Файл:** `src/app/api/storage/upload/route.ts`
**Суть:** `path.replace("..", "")` на `"....//"` → `"../"`.
**Фикс:**
```ts
const safe = path
  .replace(/\.\./g, "")
  .replace(/\/+/g, "/")
  .replace(/^\/+/, "");
if (!/^[a-zA-Z0-9_\-\/.]+$/.test(safe)) throw new Error("invalid path");
```

### BUG-032 [HIGH] analyze/video-reference: нет таймаута на Gemini Vision
**Файл:** `src/app/api/analyze/video-reference/route.ts`
**Фикс:** `signal: AbortSignal.timeout(60_000)`.

### BUG-033 [HIGH] balances: раскрывает имена внутренних ключей в ошибках
**Файл:** `src/app/api/balances/route.ts`
**Фикс:**
```ts
catch (e) {
  console.error("[balances]", e);
  return NextResponse.json({ error: "failed to fetch balance" }, { status: 500 });
}
```

### BUG-034 [HIGH] global-error.tsx: error.message отображается пользователю
**Файл:** `src/app/global-error.tsx`
**Фикс:**
```tsx
<p>Something went wrong. Error ID: {error.digest}</p>
// message и stack — только в console/Sentry
```

### BUG-035 [HIGH] assemble: нет rate-limit + нет auth-check
**Файл:** `src/app/api/generate/assemble/route.ts`
**Фикс:** добавить checkRateLimit + auth.getUser() в начало handler.

### BUG-036 [HIGH] voiceId вставляется в ElevenLabs URL без валидации
**Файл:** `src/app/api/generate/voiceover/route.ts`
**Фикс:**
```ts
if (!/^[a-zA-Z0-9_-]{10,40}$/.test(voiceId)) {
  return NextResponse.json({ error: "invalid voiceId" }, { status: 400 });
}
```

### BUG-037 [HIGH] guardScript Repair 8: @Image4 без проверки brandImages.length >= 4
**Файл:** `src/lib/pipeline-guard.ts:83`
**Фикс:**
```ts
if (lastScene && brandImagesCount >= 4 && !/@Image4/.test(lastScene.description)) {
  lastScene.description += " @Image4";
}
```

### BUG-038 [HIGH] guardFFmpegAssembly / guardAtlasPayload — dead code
**Файл:** `src/lib/pipeline-guard.ts`, `src/app/api/generate/video/route.ts`
**Фикс:** добавить вызов guardAtlasPayload(payload) перед submitAtlas; вызов guardFFmpegAssembly перед запуском ffmpeg в assemble.

### BUG-039 [HIGH] callGroq без AbortSignal
**Файл:** `src/lib/ai-router.ts:288`
**Фикс:** `signal: AbortSignal.timeout(25_000)`.

### BUG-040 [HIGH] callGemini — мёртвая функция
**Файл:** `src/lib/ai-router.ts:239`
**Фикс:** удалить, либо подключить как fallback в callLLM.

### BUG-041 [HIGH] resolveApiKey: 3 параллельных Supabase-запроса на request
**Файл:** `src/lib/user-keys.ts`
**Фикс:**
```ts
export async function resolveApiKeys(userId: string, providers: string[]) {
  const { data } = await supa.from("user_api_keys")
    .select("provider, encrypted_key")
    .eq("user_id", userId)
    .in("provider", providers);
  const map = new Map(data?.map(r => [r.provider, decryptKey(r.encrypted_key)]) ?? []);
  return Object.fromEntries(providers.map(p => [p, map.get(p) ?? process.env[`${p.toUpperCase()}_API_KEY`]]));
}
```

### BUG-042 [HIGH] projects/route.ts: service_role обходит RLS
**Файл:** `src/app/api/projects/route.ts`
**Фикс:** перейти на createServerClient() с user JWT + RLS policies в БД.

### BUG-043 [HIGH] encryptKey бросает, decryptKey — нет (несимметрия)
**Файл:** `src/lib/user-keys.ts`
**Фикс:** оба метода должны бросать Error; null возвращает только явная проверка "ключ не настроен".

### BUG-044 [HIGH] supabase-browser.ts: нет "use client"
**Файл:** `src/lib/supabase-browser.ts`
**Фикс:** `"use client";` первой строкой.

### BUG-045 [HIGH] api-keys: getUser() вызывается дважды
**Файл:** `src/app/api/user/api-keys/route.ts`
**Фикс:** кэшировать результат в локальной переменной.

### BUG-046 [HIGH] create/page.tsx: saveProject stale closure → дубль проекта
**Файл:** `src/app/create/page.tsx`
**Фикс:**
```tsx
const projectIdRef = useRef<string | null>(null);
const saveProject = useCallback(async (data) => {
  if (projectIdRef.current) {
    await fetch(`/api/projects/${projectIdRef.current}`, { method: "PUT", body: JSON.stringify(data) });
  } else {
    const { id } = await (await fetch("/api/projects", { method: "POST", body: JSON.stringify(data) })).json();
    projectIdRef.current = id;
  }
}, []);
```

### BUG-047 [HIGH] create/page.tsx: параллельные save перезаписывают свежие данные
**Файл:** `src/app/create/page.tsx`
**Фикс:** debounce + сериализация через очередь (p = p.then(() => save(data))).

### BUG-048 [HIGH] storage/upload: 200MB клиент vs 100MB API
**Файл:** `StepResult.tsx` + `storage/upload/route.ts`
**Фикс:** единая константа `export const MAX_UPLOAD_MB = 100` в `src/lib/limits.ts`.

### BUG-049 [HIGH] LogoutButton: createBrowserClient при каждом рендере
**Файл:** `src/components/LogoutButton.tsx`
**Фикс:**
```tsx
const supabase = useMemo(() => createBrowserClient(), []);
```

### BUG-050 [HIGH] LogoutButton: signOut error игнорируется → redirect loop
**Фикс:**
```tsx
const { error } = await supabase.auth.signOut();
if (error) { toast.error(error.message); return; }
router.replace("/");
```

### BUG-051 [HIGH] page.tsx: auth.getUser() без try/catch
**Файл:** `src/app/page.tsx`
**Фикс:** обернуть в try/catch, при ошибке показывать лендинг без persona.

### BUG-052 [HIGH] HeroCollageModal: heroImageUrl без валидации
**Файл:** `src/components/wizard/HeroCollageModal.tsx`
**Суть:** prompt injection + SSRF через пользовательский URL.
**Фикс:** assertPublicHttps(heroImageUrl) на сервере + экранирование в MJ prompt.

### BUG-053 [HIGH] HeroCollageModal: selected не сбрасывается
**Суть:** variants[2]=undefined после перегенерации.
**Фикс:** setSelected(0) в начале onRegenerate.

### BUG-054 [HIGH] VoiceoverSection: effectiveVoiceId пустая строка
**Файл:** `src/components/wizard/VoiceoverSection.tsx`
**Суть:** ElevenLabs возвращает 400.
**Фикс:**
```tsx
if (!effectiveVoiceId) { toast.error("выберите голос"); return; }
```

### BUG-055 [HIGH] frames: variantsPerScene=0 пустой массив
**Файл:** `src/app/api/generate/frames/route.ts`
**Фикс:** `const variants = Math.max(1, Math.min(v ?? 1, 3));`

### BUG-056 [HIGH] frames polling превышает maxDuration
**Суть:** polling 120s + quality gate 45s > 180s.
**Фикс:** вынести quality gate в отдельный job или сократить poll budget.

### BUG-057 [HIGH] RLS user_id IS NULL открывает legacy всем
**Файл:** `supabase-auth-setup.sql:58`
**Фикс:**
```sql
UPDATE projects SET user_id = '<admin-uuid>' WHERE user_id IS NULL;
ALTER TABLE projects ALTER COLUMN user_id SET NOT NULL;
CREATE POLICY "users own projects" ON projects
  FOR ALL USING (auth.uid() = user_id);
```

### BUG-058 [HIGH] user_api_keys определена дважды
**Файл:** `supabase/migrations/003_*.sql` vs `supabase-auth-setup.sql`
**Фикс:** удалить из supabase-auth-setup.sql, оставить только в миграции 003.

### BUG-059 [HIGH] jobs без RLS
**Фикс:**
```sql
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON jobs FOR ALL USING (auth.uid() = user_id);
```

### BUG-060 [HIGH] feedback RLS без SELECT policy
**Фикс:** `CREATE POLICY "own feedback read" ON feedback FOR SELECT USING (auth.uid() = user_id);`

### BUG-061 [HIGH] supabase-setup.sql конфликт с 001_initial
**Суть:** projects без user_id.
**Фикс:** удалить supabase-setup.sql полностью, оставить только миграции.

### BUG-062 [HIGH] Dockerfile COPY копирует .env
**Фикс:**
```
# .dockerignore
.env*
!.env.example
node_modules
.git
.next
```

### BUG-063 [HIGH] StepVideo.tsx:257 scenes[0] без null-check
**Файл:** `src/components/wizard/StepVideo.tsx:257`
**Фикс:**
```tsx
if (!scenes?.length) return <Empty />;
const first = scenes[0];
```

### BUG-064 [HIGH] frame_error без index зависший спиннер
**Файл:** `src/app/api/generate/frames/route.ts` + `StepFrames.tsx`
**Фикс:** всегда возвращать { type: "frame_error", index: i, error: msg }; в UI ловить и помечать как failed.

### BUG-065 [HIGH] StepVideo retry оставляет статус PENDING
**Фикс:** `if (s?.error) setStatus("FAILED");`

---
## СРЕДНИЕ (технический долг)

### BUG-066 [MED] NSFW_PHRASE_PATTERNS stateful regex
**Файл:** `src/lib/nsfw-guard.ts:64-76`
**Фикс:**
```ts
for (const p of NSFW_PHRASE_PATTERNS) {
  p.lastIndex = 0;
  if (p.test(str)) { /* ... */ }
}
```

### BUG-067 [MED] status/route responseUrl для Atlas не нужен
**Файл:** `src/app/api/generate/video/status/route.ts`
**Фикс:** валидировать только для провайдеров, которые его используют.

### BUG-068 [MED] ai-router FIX_SYSTEM теряет оригинальный system
**Файл:** `src/lib/ai-router.ts:300-304`
**Фикс:** конкатенировать originalSystem + инструкцию "Return ONLY valid JSON".

### BUG-069 [MED] loudnorm не реализован в assemble
**Файл:** `src/app/api/generate/assemble/route.ts:387-404`
**Фикс:** добавить в filter chain `loudnorm=I=-16:TP=-1.5:LRA=11`.

### BUG-070 [MED] cp vs fs.copyFile Windows incompatibility
**Файл:** `src/app/api/generate/assemble/route.ts:410`
**Фикс:** `await fs.promises.copyFile(src, dst)`.

### BUG-071 [MED] descriptionRu optional vs required несоответствие
**Файл:** `src/lib/pipeline-guard.ts`
**Фикс:** в guardScript добавить `scene.descriptionRu ??= scene.description`.

### BUG-072 [MED] probeFFmpegTransitions на импорте cold start 25s
**Файл:** `src/app/api/generate/assemble/route.ts:10`
**Фикс:** lazy init, кэш в globalThis.

### BUG-073 [MED] brand-dna imageUrls без SSRF проверки
**Файл:** `src/app/api/analyze/brand-dna/route.ts`
**Фикс:** assertPublicHttps на каждый URL.

### BUG-074 [MED] projects GET без limit, PUT до 10MB
**Файл:** `src/app/api/projects/route.ts`
**Фикс:** `.select("id,name,status,updated_at").limit(50)`; проверка размера body.

### BUG-075 [MED] enhance/image file и data схемы не блокируются
**Фикс:** whitelist только https.

### BUG-076 [MED] health/route всегда 200
**Фикс:**
```ts
const checks = await Promise.allSettled([
  supabase.from("profiles").select("count").limit(1),
  fetch("https://api.openai.com", { method: "HEAD", signal: AbortSignal.timeout(3000) }),
]);
const ok = checks.every(c => c.status === "fulfilled");
return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
```

### BUG-077 [MED] analyze/website Firecrawl без таймаута
**Фикс:** `signal: AbortSignal.timeout(30_000)`.

### BUG-078 [MED] storage/upload WAV WEBP RIFF collision
**Файл:** `src/app/api/storage/upload/route.ts`
**Фикс:**
```ts
if (magic.startsWith("RIFF")) {
  const sub = buf.slice(8, 12).toString();
  if (sub === "WAVE") mime = "audio/wav";
  else if (sub === "WEBP") mime = "image/webp";
  else throw new Error("unknown RIFF");
}
```

### BUG-079 [MED] auth.getUser без timeout
**Фикс:** обернуть в Promise.race с 5000ms.

### BUG-080 [MED] supabase.ts дублирует createServiceClient
**Фикс:** удалить supabase.ts, использовать один источник из supabase-server.ts.

### BUG-081 [MED] projects UUID не валидируется
**Фикс:** `z.string().uuid().parse(id)` перед Supabase-запросом.

### BUG-082 [MED] guardModelChain fal.ai ping неправильный
**Файл:** `src/lib/pipeline-guard.ts:264`
**Фикс:** использовать https://queue.fal.run/health с проверкой 401/403.

### BUG-083 [MED] NSFW false positives
**Суть:** hot/gun/drug/alcohol ловят легитимные кейсы.
**Фикс:** word boundaries `\bgun\b` + список исключений.

### BUG-084 [MED] probeFFmpegTransitions параллельный CPU spike
**Фикс:** sequential + кэш в global.

### BUG-085 [MED] INTERNAL_API_SECRET === timing attack
**Фикс:**
```ts
import { timingSafeEqual } from "crypto";
const a = Buffer.from(received);
const b = Buffer.from(expected);
if (a.length !== b.length || !timingSafeEqual(a, b)) return 401;
```

### BUG-086 [MED] n8n webhook без авторизации
**Фикс:** HMAC-подпись запросов, проверка на n8n side.

### BUG-087 [MED] Open redirect: next после логина
**Фикс:**
```ts
const next = searchParams.get("next") ?? "/dashboard";
if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
```

### BUG-088 [MED] /reset-password не в GUEST_ONLY
**Фикс:** добавить в middleware matcher + GUEST_ONLY_ROUTES.

### BUG-089 [MED] error.message в API responses
**Фикс:** возвращать { error: "generation failed", code: "GEN_001" }, detail в логи.

### BUG-090 [MED] BalanceDashboard без res.ok проверки
**Файл:** `src/components/BalanceDashboard.tsx`
**Фикс:**
```tsx
const res = await fetch("/api/balances");
if (!res.ok) { setError("failed"); return; }
const data = await res.json();
```

### BUG-091 [MED] VideoReferenceUpload URL без валидации
**Фикс:** schema https only, блокировать javascript:/file:/data:.

### BUG-092 [MED] layout.tsx без cyrillic subset
**Файл:** `src/app/layout.tsx`
**Фикс:** `const inter = Inter({ subsets: ["latin", "cyrillic"] });`

### BUG-093 [MED] Sentry не подключён через withSentryConfig
**Файл:** `next.config.ts`
**Фикс:** `module.exports = withSentryConfig(nextConfig, sentryOptions)`.

### BUG-094 [MED] VoiceoverSection word count делитель 2.5 для english при russian
**Фикс:** детектировать lang, использовать 1.5 wps для русского.

### BUG-095 [MED] CI без npm test
**Фикс:** добавить smoke-тесты (vitest) + запуск в GitHub Actions перед deploy.

### BUG-096 [MED] projects без индекса на status
**Фикс:**
```sql
CREATE INDEX idx_projects_status ON projects(user_id, status, updated_at DESC);
```

### BUG-097 [MED] deploy health check результат не проверяется
**Фикс:**
```bash
if ! curl -fsS https://app.example.com/api/health; then
  echo "health check failed"; exit 1;
fi
```

### BUG-098 [MED] Dockerfile output standalone не проверяется
**Фикс:** в next.config.ts явно `output: "standalone"`, в Dockerfile `COPY .next/standalone ./`.

### BUG-099 [MED] INTERNAL_API_SECRET если не задан роуты открыты
**Фикс:** `if (!process.env.INTERNAL_API_SECRET) throw new Error("required");` на старте.

### BUG-100 [MED] NEXT_PUBLIC_GEMINI_QUALITY_SCORE не задокументирован
**Фикс:** добавить в .env.example с комментарием.

---
## НИЗКИЕ

### BUG-101 [LOW] cameraMovements без ограничения длины (prompt injection)
**Файл:** `src/app/api/generate/script/route.ts:358-360`
**Фикс:** `.slice(0, 500)` + strip control chars.

### BUG-102 [LOW] buildNSFWFallbackPrompt возвращает точку
**Файл:** `src/lib/nsfw-guard.ts`
**Фикс:** `if (sentences.length === 0) return sanitized || "abstract scene";`

### BUG-103 [LOW] brand-dna brandColors substring crash
**Фикс:** `(dna.brandColors ?? []).slice(0, 5)`.

### BUG-104 [LOW] api-keys encryptKey без try/catch
**Фикс:** обернуть + вернуть 400 "invalid key format".

### BUG-105 [LOW] fal.ai billing неверный хост
**Файл:** `src/app/api/balances/route.ts`
**Фикс:** использовать `https://api.fal.ai/...` вместо `fal.ai`.

### BUG-106 [LOW] dashboard/settings не существует 404
**Фикс:** создать страницу-заглушку либо убрать ссылку.

### BUG-107 [LOW] HeroCollageModal не отменяет предыдущий запрос
**Фикс:**
```tsx
const abortRef = useRef<AbortController>();
abortRef.current?.abort();
abortRef.current = new AbortController();
fetch(url, { signal: abortRef.current.signal });
```

### BUG-108 [LOW] supabase-server setAll пустой catch
**Фикс:** `catch (e) { console.warn("[supabase-server] setAll failed", e); }`.

### BUG-109 [LOW] docker-compose /tmp bind mount
**Файл:** `docker-compose.yml`
**Фикс:** использовать named volume `ffmpeg-tmp:/tmp` вместо bind.

### BUG-110 [LOW] handle_new_user без ON CONFLICT
**Файл:** `supabase-auth-setup.sql`
**Фикс:**
```sql
INSERT INTO profiles (id, email) VALUES (NEW.id, NEW.email)
ON CONFLICT (id) DO NOTHING;
```

---
## ENV ПЕРЕМЕННЫЕ

| # | Переменная | Назначение | В .env.example |
|---|---|---|---|
| 1 | NEXT_PUBLIC_SUPABASE_URL | Supabase project URL (public) | + |
| 2 | NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key (public) | + |
| 3 | SUPABASE_SERVICE_ROLE_KEY | Supabase service-role (admin) | + |
| 4 | GEMINI_API_KEY | Google Gemini (script/vision) | + |
| 5 | GROQ_API_KEY | Groq LLM (fast script) | + |
| 6 | OPENROUTER_API_KEY | OpenRouter (Claude fallback) | — ДОБАВИТЬ |
| 7 | ATLAS_CLOUD_API_KEY | Atlas Cloud (Seedance video) | + |
| 8 | FAL_API_KEY | fal.ai (video fallback) | + |
| 9 | PIAPI_KEY | PiAPI (Midjourney assets) | + |
| 10 | HUGGINGFACE_TOKEN | HF (Flux keyframes) | + |
| 11 | ELEVENLABS_API_KEY | ElevenLabs (voiceover) | + |
| 12 | ENCRYPTION_KEY | AES-GCM (>=32 chars) | + |
| 13 | INTERNAL_API_SECRET | HMAC для internal-only routes | + |
| 14 | N8N_ASSEMBLE_WEBHOOK_URL | n8n FFmpeg-assembler | — ДОБАВИТЬ |
| 15 | FIRECRAWL_API_KEY | Firecrawl (analyze/website) | — ДОБАВИТЬ |
| 16 | NEXT_PUBLIC_GEMINI_QUALITY_SCORE | UI quality gate threshold | — ДОБАВИТЬ |
| 17 | NEXT_PUBLIC_SENTRY_DSN | Sentry (client) | — ДОБАВИТЬ |
| 18 | SENTRY_AUTH_TOKEN | Sentry source maps upload | — ДОБАВИТЬ |
| 19 | TRUST_PROXY | Флаг для rate-limit за nginx | — ДОБАВИТЬ (см. BUG-014) |
| 20 | UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN | Redis для distributed rate-limit | — ДОБАВИТЬ (см. BUG-016) |

---
## ПОДТВЕРЖДЕНО РАБОТАЮЩИМ

- Zod-валидация входных данных в script/route.ts (кроме parse-ветки — BUG-024)
- NSFW fallback chain логически существует (проблема только в недоставленной model — BUG-009)
- supabase-server.ts корректно реализует createServerClient с cookies
- Middleware применяет auth для защищённых роутов (кроме пропущенного storage — BUG-003)
- Atlas Cloud: формат payload (prompt/image) соответствует docs
- Seedance 2.0 pro выбран как primary — соответствует эталону Егора Кузьмина
- pipeline-guard.guardScript реализует все 8 repair-шагов (кроме context-aware @Image4 — BUG-037)
- FFmpeg-пайплайн собирает видео корректно при наличии rawOutput (но см. BUG-025)
- Supabase RLS включён на большинстве таблиц (кроме jobs/feedback — BUG-059/060)
- Структура wizard-шагов (Brief → Script → Frames → Video → Result) логична
- TypeScript strict mode включён в tsconfig.json
- Sentry installed (но не подключён через withSentryConfig — BUG-093)

---
## ПРИОРИТИЗАЦИЯ ИСПРАВЛЕНИЙ

**День 0 (до первого пользователя):** BUG-001, 002, 003, 004, 005, 006, 007, 008, 014 — auth/secrets.

**Неделя 1:** BUG-009, 010, 011, 012, 013, 015 (остальные CRIT) + BUG-016 (rate-limit) + BUG-017 (применить везде) + BUG-018 (CSP).

**Неделя 2:** HIGH связанные с биллингом — BUG-021 (idempotency), BUG-019/030/032 (таймауты), BUG-029/056 (polling).

**Месяц 1:** MED технический долг + ENV документация.

**Бэклог:** LOW + рефакторинг dead code (BUG-040 callGemini, BUG-038 guards).
