# EXHAUSTIVE AUDIT PLAN — AI Video Factory
# Цель: после этого анализа новых багов быть НЕ МОЖЕТ

## Принцип: каждый файл читается ЦЕЛИКОМ, каждый контракт проверяется обоими сторонами

---

## ФАЗА 1 — Параллельный анализ по группам (все агенты одновременно)

### Агент A1: API Generate — Video Pipeline
**Файлы (читать все целиком):**
- `src/app/api/generate/video/route.ts`
- `src/app/api/generate/video/status/route.ts`
- `src/app/api/generate/frames/route.ts`

**Что искать:**
1. Все вызовы fetch — есть ли AbortSignal + timeout? Что при timeout?
2. submitAtlas: 3 retry — между попытками очищается ли controller/timer? Утечка таймаутов?
3. NSFW fallback chain — `for (const model of NSFW_FALLBACK_CHAIN)` внутри всегда вызывает `submitFal` без перебора модели (model не передаётся в submitFal) — баг?
4. `body.keyframes[i]` — что если keyframes.length < script.length? IndexOutOfBounds?
5. status/route.ts — polling работает через Atlas и fal.ai по разным схемам: а как определяется провайдер для конкретного request_id?
6. frames/route.ts — возвращает URL или base64? Кто потребляет, совпадают ли форматы?
7. Все env переменные — объяви список всех используемых
8. Все TypeScript типы в responses — совпадают ли с тем что ожидает StepVideo.tsx?
9. Идемпотентность — двойной сабмит одной сцены = двойной биллинг?
10. Батчинг 3 сцены — если вторая сцена упала, индексы в allResults соответствуют индексам body.script?

---

### Агент A2: API Generate — Script + Assemble
**Файлы:**
- `src/app/api/generate/script/route.ts`
- `src/app/api/generate/script/parse/route.ts`
- `src/app/api/generate/assemble/route.ts`

**Что искать:**
1. script/route.ts — LLM prompt: есть ли system prompt для Gemini vs OpenRouter? Разные форматы ответа?
2. Zod schema — validate происходит ПЕРЕД или ПОСЛЕ guardScript? Если LLM вернул невалидный JSON, он попадает в guardScript или падает раньше?
3. parse/route.ts — зачем этот роут? Дублирует ли script/route.ts? Оба вызываются или только один?
4. assemble/route.ts — getTransition() возвращает тип и duration: кто проверяет что getSafeTransition вызван ПЕРЕД передачей в FFmpeg команду?
5. assemble — buildFilterGraph(): все string templates — нет ли SQL/shell injection через videoUrls или mood?
6. assemble — download клипов: есть ли SSRF защита (redirect: "manual")?
7. assemble — tmp файлы: гарантировано ли cleanup при ошибке? try/finally?
8. assemble — FFmpeg команда через spawn: аргументы через массив (безопасно) или через shell string (инъекция)?
9. assemble — loudnorm двухпроходная нормализация: реализована ли она? Или однопроходная (менее точная)?
10. getColorGrade — curves синтаксис: `:` между каналами, не `,`? (уже фиксили — проверить что правки применились)
11. getTransition — все transition names из getSafeTransition? Или где-то ещё hardcoded hblur/vibrance?

---

### Агент A3: API Generate — Assets, Collage, Voiceover, Export
**Файлы:**
- `src/app/api/generate/auto-assets/route.ts`
- `src/app/api/generate/hero-collage/route.ts`
- `src/app/api/generate/voiceover/route.ts`
- `src/app/api/generate/export/route.ts`

**Что искать:**
1. auto-assets — какой AI генерирует ассеты? Есть ли таймаут?
2. hero-collage — Nano Banana API: какой endpoint, какие поля? Если сервис лёг, что возвращает клиенту?
3. voiceover — TTS провайдер: ElevenLabs, OpenAI TTS, или другой? Максимальная длина текста?
4. voiceover — возвращает blob или URL? Куда сохраняется? Supabase Storage?
5. export — что экспортируется: финальное видео или мета-данные? Какой формат?
6. Все роуты — rate limiting применён? Какие лимиты?
7. Все роуты — auth проверка: middleware защищает или каждый роут сам?
8. Все роуты — response body: есть ли поля которые ожидает фронтенд но роут не возвращает?

---

### Агент A4: API Analyze + Балансы + Проекты
**Файлы:**
- `src/app/api/analyze/brand-dna/route.ts`
- `src/app/api/analyze/asset-quality/route.ts`
- `src/app/api/analyze/video-reference/route.ts`
- `src/app/api/analyze/website/route.ts`
- `src/app/api/balances/route.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/user/api-keys/route.ts`
- `src/app/api/storage/upload/route.ts`
- `src/app/api/health/route.ts`
- `src/app/api/enhance/image/route.ts`

**Что искать:**
1. balances/route.ts — откуда берёт балансы Atlas и fal.ai? Кэшируется? Таймаут запроса к внешним API?
2. projects/route.ts — Supabase запросы: все с `.limit()` чтобы не вернуть 10000 строк?
3. storage/upload/route.ts — streaming upload или буферизация в памяти? Максимальный размер?
4. storage/upload — проверка MIME-type: по Content-Type header (подделывается) или по magic bytes?
5. health/route.ts — вызывает ли guardModelChain? Возвращает ли статус всех провайдеров?
6. enhance/image — какая модель? Таймаут?
7. Все analyze роуты — какие LLM используются? Есть ли fallback при ошибке?
8. api-keys — хранятся ли ключи в открытом виде или зашифрованы?
9. website/route.ts — скрапит URL пользователя: SSRF защита?

---

### Агент A5: Lib — AI Router, Validator, Prompt Engineer
**Файлы:**
- `src/lib/ai-router.ts`
- `src/lib/ai-validator.ts`
- `src/lib/prompt-engineer.ts`
- `src/lib/rate-limit.ts`
- `src/lib/user-keys.ts`

**Что искать:**
1. ai-router.ts — сколько провайдеров? Как выбирается провайдер? Если все упали?
2. ai-router — таймауты на каждый провайдер? AbortController?
3. ai-router — resolveApiKey вызывается внутри? Сколько раз на один запрос?
4. ai-validator.ts — validateScriptQuality: какие критерии? Если Groq лёг, что возвращает?
5. prompt-engineer.ts — buildSystemPrompt для script: есть ли few-shot примеры? Есть ли инструкция по @Image тегам?
6. prompt-engineer — анти-коррекция hints (не "adjust", "enhance" → "apply directly"): реализованы?
7. rate-limit.ts — in-memory Map: при рестарте сервера лимит сбрасывается? Это проблема?
8. rate-limit — IP extraction: X-Forwarded-For подделывается, есть ли защита?
9. user-keys.ts — кэш per-request: реализован? Или каждый вызов = новый Supabase запрос?
10. user-keys — ключи возвращаются в plaintext через API? Или только boolean "есть/нет"?

---

### Агент A6: Lib — FFmpeg, NSFW, Pipeline Guards
**Файлы:**
- `src/lib/ffmpeg-probe.ts`
- `src/lib/nsfw-guard.ts`
- `src/lib/pipeline-guard.ts`

**Что искать:**
1. ffmpeg-probe.ts — `probeFFmpegTransitions()` вызывается при старте? Или только по требованию? Если не вызван, getSafeTransition работает (fallback к dissolve)?
2. ffmpeg-probe — batch 8 параллельных FFmpeg процессов: не убьёт ли сервер при cold start?
3. ffmpeg-probe — тест использует реальный FFmpeg spawn: в Docker image FFmpeg установлен?
4. ffmpeg-probe — _verified Set: если probe не запускался, Set пустой → getSafeTransition всегда возвращает dissolve. Это ок поведение?
5. nsfw-guard — NSFW_WORD_MAP применяется word-boundary regex: `chest` в `orchestra` → `torso`? Проверь false positives
6. nsfw-guard — `hot` → `energetic`: "hot chocolate" → "energetic chocolate"? Это нормально?
7. nsfw-guard — phrase patterns до word замен: если оба паттерна подходят, нет двойной замены?
8. pipeline-guard — guardScript Repair 8 (добавляет @Image4 в последнюю сцену): что если brandImages[3] не существует (только 2 изображения загружено)?
9. pipeline-guard — guardFFmpegAssembly вызывается где? Если не вызывается в assemble/route.ts, то к чему он?
10. pipeline-guard — guardModelChain: fal.ai ping через `/fal-ai/status` — этот эндпоинт реально существует?

---

### Агент A7: Lib — Supabase, Utils
**Файлы:**
- `src/lib/supabase.ts`
- `src/lib/supabase-browser.ts`
- `src/lib/supabase-server.ts`
- `src/lib/utils.ts`

**Что искать:**
1. supabase.ts — createClient вызывается per-request или синглтон? Per-request = connectionpool exhaustion
2. supabase-server.ts — cookies() вызов: Next.js 15 требует `await cookies()` — используется ли await?
3. supabase — все запросы с таймаутом? Один зависший запрос = зависший API endpoint?
4. supabase — RLS политики: projects таблица защищена от чтения чужих проектов?
5. supabase — tasks таблица: есть ли soft-delete или hard-delete?
6. utils.ts — что содержит? Есть ли функции которые дублируют логику из других файлов?
7. supabase-browser — используется только на клиенте? Нет ли импорта в серверных роутах?

---

### Агент A8: Компоненты Wizard (Step*)
**Файлы:**
- `src/components/wizard/StepBrief.tsx`
- `src/components/wizard/StepScript.tsx`
- `src/components/wizard/StepFrames.tsx`
- `src/components/wizard/StepVideo.tsx`
- `src/components/wizard/StepResult.tsx`

**Что искать:**
1. StepBrief — форма: валидация на клиенте? Что при submit с пустыми полями?
2. StepBrief — brandImages upload: сколько максимум файлов? Ограничение размера?
3. StepScript — SSE stream: AbortController при unmount компонента? Утечка?
4. StepScript — если script API вернул ошибку, отображается ли она пользователю?
5. StepFrames — keyframes poll: polling interval? Exponential backoff?
6. StepVideo — вызывает video API с правильным body? Все поля из script и keyframes?
7. StepVideo — показывает статус каждой сцены? Частичный успех (3/5 сцен)?
8. StepResult — download: что если finalVideoUrl = null?
9. Все Steps — loading state: блокирует ли повторный submit?
10. Wizard state — где хранится? Zustand? Context? При refresh страницы сохраняется?

---

### Агент A9: Компоненты — вспомогательные + Pages
**Файлы:**
- `src/components/wizard/HeroCollageModal.tsx`
- `src/components/wizard/VideoReferenceUpload.tsx`
- `src/components/wizard/VoiceoverSection.tsx`
- `src/components/BalanceDashboard.tsx`
- `src/components/LogoutButton.tsx`
- `src/app/create/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/page.tsx`
- `src/app/layout.tsx`

**Что искать:**
1. HeroCollageModal — submit: body формат соответствует hero-collage API?
2. VideoReferenceUpload — загружает видео куда? Supabase Storage или прямо в API?
3. VoiceoverSection — TTS текст берётся из script.description или отдельное поле?
4. BalanceDashboard — реальный баланс или захардкоженный? Откуда данные?
5. create/page.tsx — рендерит Wizard: есть ли Suspense boundary?
6. dashboard — список проектов: pagination? Limit?
7. layout.tsx — Sentry инициализация? Meta теги? CSP header?
8. page.tsx (главная) — static или dynamic? SEO meta?
9. Все страницы — auth check: middleware или per-page?

---

### Агент A10: Auth + Middleware + Config
**Файлы:**
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/register/page.tsx`
- `src/app/(auth)/verify-email/page.tsx`
- `src/app/(auth)/reset-password/page.tsx`
- `src/middleware.ts`
- `src/app/global-error.tsx`
- `next.config.ts`
- `tsconfig.json`
- `.env.example`

**Что искать:**
1. middleware.ts — какие роуты защищены? `/api/generate/*` требует auth?
2. middleware — supabase-server используется для проверки сессии: правильно async?
3. login/register — rate limiting на auth endpoints? Brute force?
4. register — email whitelist до открытия: реализован?
5. verify-email — токен в URL: проверяется на сервере?
6. reset-password — новый пароль без min length?
7. global-error.tsx — Sentry.captureException вызывается?
8. next.config.ts — allowedOrigins/CSP headers настроены?
9. .env.example — все переменные из кода перечислены? Нет ли "секретных" переменных которые не задокументированы?
10. tsconfig.json — strict mode включён? Paths алиасы совпадают с реальной структурой?

---

### Агент A11: DevOps + Infrastructure
**Файлы:**
- `Dockerfile`
- `docker-compose.yml`
- `deploy.sh`
- `.github/workflows/ci.yml`
- `n8n/workflow-assemble.json` (если есть)
- `supabase/migrations/*.sql`
- `supabase-setup.sql`
- `supabase-auth-setup.sql`

**Что искать:**
1. Dockerfile — FFmpeg установлен? Правильная версия?
2. Dockerfile — NODE_ENV=production? Non-root user?
3. Dockerfile — .env файл не копируется в image?
4. docker-compose — секреты через env_file или secrets? Не в yaml напрямую?
5. deploy.sh — идемпотентный? Можно запустить дважды без разрушений?
6. ci.yml — lint, typecheck, tests? Или только build?
7. migrations — порядок: 001, 002, 003, 004 — зависимости между ними корректны?
8. migrations — RLS включён на всех таблицах?
9. supabase-setup.sql — индексы на часто запрашиваемых полях (user_id, status)?
10. n8n workflow — какие шаги? Соответствует ли assemble/route.ts?

---

### Агент A12: TypeScript Types + Cross-file Contracts
**Цель:** проверить что типы на границах API совпадают

**Задачи:**
1. script/route.ts → response type → StepScript.tsx ожидаемый тип
2. video/route.ts → response `scenes[]` → StepVideo.tsx как использует
3. frames/route.ts → response → StepFrames.tsx
4. assemble/route.ts → body type → StepResult.tsx что передаёт
5. storage/upload/route.ts → response → где вызывается на клиенте
6. Env переменные: собрать полный список из всего кода → сравнить с .env.example
7. Supabase таблицы: схема из migrations → типы в коде (есть ли TypeScript типы?)
8. AI Router: какие поля в request/response для каждого провайдера?
9. Rate limit: ключи в rate-limit Map — уникальны ли для разных endpoints?

---

## ФАЗА 2 — Cross-reference агенты (после Фазы 1)

### Агент B1: API Contract Validator
Берёт отчёты A1-A4 и A8-A9.
**Для каждого API endpoint:**
- body который роут ожидает vs body который компонент отправляет
- response который роут возвращает vs поля которые компонент читает
- error shapes — единый формат `{error: string}` или разные?

### Агент B2: Security Auditor
Берёт отчёты всех агентов A1-A11.
**Фокус:**
- SSRF: все fetch с user-provided URL
- Command injection: все spawn/exec с user-provided данными
- XSS: все dangerouslySetInnerHTML или unescaped вывод
- Leaking: API ключи в response bodies, в logs, в error messages
- Auth bypass: endpoints без проверки auth
- IDOR: Supabase запросы без user_id фильтра

### Агент B3: Performance + Reliability
Берёт отчёты A5-A7 и A11.
**Фокус:**
- Все Supabase запросы без timeout
- Memory leaks: setInterval без clearInterval, EventSource без close
- Connection pool: сколько Supabase клиентов создаётся per-request?
- FFmpeg процессы: cleanup при ошибке?
- Tmp файлы в /tmp: cleanup при crash?

---

## ФАЗА 3 — Синтез

### Агент C1: Final Synthesizer
Читает ВСЕ отчёты Фаз 1-2.
Создаёт `FINAL-BUG-REPORT.md`:

```
## КРИТИЧЕСКИЕ (блокируют деплой)
[ID] Файл:строка | Описание | Ready-to-paste fix

## ВЫСОКИЕ (исправить до первого пользователя)
...

## СРЕДНИЕ (исправить в течение недели)
...

## НИЗКИЕ / технический долг
...

## ПОДТВЕРЖДЕНИЯ (было починено, работает)
...

## ENV переменные — полный список
...

## API контракты — матрица совпадений
...
```

---

## Правила для каждого агента:

1. **Читать каждый файл ЦЕЛИКОМ** — не частично
2. **Для каждой находки**: файл + строка + конкретное описание + готовый фикс
3. **Не писать "возможно"** — только конкретные баги или "OK"
4. **Если файл не существует** — это тоже баг (ожидается импорт но файла нет)
5. **Проверять импорты**: все `import { X } from "@/lib/Y"` — X реально экспортируется из Y?
6. **Отчёт заканчивается строкой**: "ФАЙЛЫ ПРОЧИТАНЫ ЦЕЛИКОМ: [список файлов]"

---

## Запуск: 12 агентов параллельно в Фазе 1
```
Agent A1 + A2 + A3 + A4 + A5 + A6 + A7 + A8 + A9 + A10 + A11 + A12 → одновременно
```
После завершения всех → запуск B1 + B2 + B3 → после → C1

**Ожидаемый результат:** один файл `FINAL-BUG-REPORT.md` с нулевым количеством "внезапных" находок после него.
