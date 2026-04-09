# Фаза 0 — Настройка (чеклист)

## 1. GitHub репозиторий

```bash
cd /Users/vagiz/Documents/Projects/video-service
git init
git add .
git commit -m "feat: initial project structure (Phase 0)"
# Создай репо на github.com/new → ai-video-factory
git remote add origin https://github.com/YOUR_USERNAME/ai-video-factory.git
git push -u origin main
```

## 2. Supabase

1. Зайди на [supabase.com](https://supabase.com) → New project
2. Имя: `ai-video-factory`, регион: ближайший к тебе
3. **SQL Editor** → вставь и запусти:
   - `supabase/migrations/001_initial.sql`
   - `supabase/migrations/002_seed_prompts.sql`
4. **Storage** → Create bucket → Name: `videos`, Public: ON
5. Скопируй из Settings → API:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

## 3. Google Gemini API

1. Зайди на [aistudio.google.com](https://aistudio.google.com/apikey)
2. Create API key → скопируй в `GEMINI_API_KEY`
3. Лимиты бесплатного тира: Flash-Lite 1000 req/день, Flash 250 req/день

## 4. HuggingFace Token

1. [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. New token → Read access → скопируй в `HUGGINGFACE_TOKEN`

## 5. fal.ai (для видео-генерации)

1. [fal.ai](https://fal.ai) → Sign up → Dashboard → API Keys
2. Create key → скопируй в `FAL_API_KEY`
3. Пополни баланс минимально ($5) — хватит на ~170 секунд видео

## 6. Cloudflare Pages

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Pages → Create a project
2. Connect to Git → выбери `ai-video-factory` репо
3. Build settings:
   - **Framework preset:** Next.js
   - **Build command:** `npm run pages:build`
   - **Build output directory:** `.vercel/output/static`
4. Environment variables — добавь все из `.env.example` (кроме URL начинающихся с localhost)
5. После деплоя: скопируй `*.pages.dev` URL в `NEXT_PUBLIC_APP_URL`

## 7. GitHub Secrets (для CI/CD)

Settings → Secrets → Actions → добавь:
- `CLOUDFLARE_API_TOKEN` — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Cloudflare Pages Edit
- `CLOUDFLARE_ACCOUNT_ID` — dash.cloudflare.com → правый нижний угол
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 8. n8n — импорт воркфлоу

В твоём n8n:
1. Workflows → Import from file → `n8n/workflow-assemble.json`
2. Настрой credentials для Supabase (HTTP Header Auth: `Authorization: Bearer SERVICE_ROLE_KEY`)
3. Активируй workflow, скопируй webhook URL → `N8N_ASSEMBLE_WEBHOOK_URL`

## 9. Локальный запуск

```bash
cp .env.example .env.local
# Заполни все переменные
npm install
npm run dev
# Открой http://localhost:3000
```

## Чеклист готовности Фазы 0

- [ ] `npm run dev` запускается без ошибок
- [ ] Открывается главная страница
- [ ] `/create` показывает Step 1 (Brief)
- [ ] Supabase: таблицы созданы, промты загружены
- [ ] Cloudflare Pages: деплой прошёл
- [ ] CI/CD: push в main → автодеплой
- [ ] n8n workflow: активен, webhook отвечает

## Следующий шаг — Фаза 1

После прохождения чеклиста скажи "Фаза 0 готова, начинаем Фазу 1".
Фаза 1: полный пайплайн для косметических роликов (MVP).
