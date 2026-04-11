# План запуска AI Video Factory

## Текущее состояние (9 апреля 2026)

| Компонент | Статус | Заметки |
|-----------|--------|---------|
| Step 1 — Бриф | ✅ Работает | Авто-заполнение по URL тоже |
| Step 2 — Сценарий | ✅ Работает | Groq llama-3.3-70b |
| Step 3 — Кадры | ✅ Работает | HuggingFace Flux schnell |
| Step 4 — Видео | ✅ fal.ai ($6) | Kling v2 standard |
| Step 5 — Сборка | ✅ n8n на сервере | FFmpeg 7.0.2 static |
| Хранилище | ⚠️ Нужна проверка | Supabase bucket "videos" |
| Деплой | ❌ Не настроен | Cloudflare Pages |

---

## ЭТАП 1 — Проверка Supabase (15 мин)

### 1.1 Создать публичный bucket "videos"

Зайди: https://supabase.com/dashboard → проект → Storage

Если bucket "videos" не существует:
- Нажми "New bucket"
- Имя: `videos`
- Public: **включить**
- Сохранить

Если существует — проверь что он **публичный** (Public bucket).

### 1.2 Создать папки (RLS политики)

В Supabase SQL Editor выполни:

```sql
-- Разрешить публичную загрузку и чтение
CREATE POLICY "Public Access" ON storage.objects
  FOR ALL USING (bucket_id = 'videos');
```

Или в Storage → Policies → Add policy → "Allow all operations for all users"

### 1.3 Проверить папки в bucket

Нужны папки:
- `frames/` — ключевые кадры (HuggingFace)
- `assembled/` — финальные ролики (FFmpeg)

Supabase создаёт папки автоматически при первой загрузке.

---

## ЭТАП 2 — Тест полного пайплайна локально (30 мин)

### 2.1 Запусти dev сервер

```bash
cd /Users/vagiz/Documents/Projects/video-service
npm run dev
```

### 2.2 Запусти n8n (нужен только локально для ассемблера)

n8n на сервере koyiequoquulee.beget.app работает постоянно — локальный не нужен.

### 2.3 Пройди все 5 шагов

1. Бриф: заполни вручную (бренд Befree, мода, девушки 18-28)
2. Сценарий: нажми "Сгенерировать" — ждать ~10 сек
3. Кадры: нажми "Генерировать кадры" — ждать ~60 сек
4. Видео: нажми "Генерировать видеоклипы" — ждать ~3 мин
5. Сборка: нажми "Собрать финальное видео" — ждать ~2 мин

### 2.4 Что проверить на каждом шаге

- Step 3: кадры должны загрузиться (изображения видны)
- Step 4: видео должны воспроизводиться (не пустые)
- Step 5: финальное видео скачивается

---

## ЭТАП 3 — Исправление критических багов

### 3.1 next/image: добавить CDN fal.ai в whitelist

Видео с fal.ai хранятся на их CDN. Нужно добавить в next.config.ts:

```ts
// Добавить в remotePatterns:
{ protocol: "https", hostname: "**.fal.run" },
{ protocol: "https", hostname: "v3.fal.media" },
{ protocol: "https", hostname: "**.fal.media" },
```

### 3.2 StepVideo: фильтровать пустые клипы

В src/components/wizard/StepVideo.tsx добавить фильтр как в StepFrames:

```ts
const { videoClips, musicUrl } = await res.json();
const validClips = videoClips.filter((url: string) => url && url.length > 0);
if (validClips.length === 0) throw new Error("Все клипы пустые — проверь баланс fal.ai");
onUpdate({ videoClips: validClips, ... });
```

### 3.3 Assemble route: убрать child_process для Cloudflare

Файл `src/app/api/generate/assemble/route.ts` использует `child_process` — это НЕ работает на Cloudflare Pages.

**Решение**: на Cloudflare всегда используется n8n. Локально — локальный ffmpeg.

```ts
// Определяем окружение
const isCloudflare = process.env.CF_PAGES === "1";
if (isCloudflare && !n8nWebhookUrl) {
  return NextResponse.json({ error: "N8N_ASSEMBLE_WEBHOOK_URL не настроен" }, { status: 500 });
}
```

### 3.4 Timeout проблема на Cloudflare Pages

Cloudflare Pages Functions лимит: **50ms CPU** (бесплатно).

Это КРИТИЧЕСКИ мало для:
- Step 3 (кадры): ~60 сек — **НЕ БУДЕТ РАБОТАТЬ** на Cloudflare
- Step 4 (видео): ~3 мин — **НЕ БУДЕТ РАБОТАТЬ** на Cloudflare

**Решение: перенести генерацию в n8n**

Смотри Этап 4.

---

## ЭТАП 4 — Перенос тяжёлых операций в n8n (2-3 часа)

Cloudflare Pages не подходит для долгих API-вызовов. Архитектура должна быть:

```
Browser → Cloudflare Pages (мгновенно) → n8n webhook (выполняет задачу) → Supabase (результат)
```

### 4.1 Паттерн: Fire & Poll

Вместо "жди пока выполнится", делаем:
1. POST /api/generate/frames → отправляет задачу в n8n → возвращает taskId
2. GET /api/status/[taskId] → клиент опрашивает каждые 3 сек
3. Когда n8n закончил → записывает результат в Supabase → клиент получает URL

### 4.2 N8N workflows нужны для:

| Workflow | Webhook URL | Время |
|----------|-------------|-------|
| frames-generator | /webhook/generate-frames | ~60 сек |
| video-generator | /webhook/generate-video | ~3 мин |
| video-assembler | /webhook/video-assemble | ~2 мин |

### 4.3 Таблица статусов в Supabase

```sql
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL, -- 'frames', 'video', 'assemble'
  status TEXT DEFAULT 'pending', -- pending, processing, done, error
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.4 Пока эта архитектура не готова — деплой на VPS

Самый простой путь к рабочему продукту без рефакторинга:

**Запускать Next.js прямо на Beget VPS** рядом с n8n.

```bash
# На сервере 155.212.141.8:
git clone https://github.com/USER/video-service.git /opt/video-service
cd /opt/video-service
npm install
npm run build
npm start  # порт 3001 (n8n занимает 5678)
```

Traefik уже настроен — добавь ещё один роутер для Next.js приложения.

---

## ЭТАП 5 — Деплой на VPS (рекомендуется для MVP)

### 5.1 Добавить Next.js в docker-compose.yml на сервере

```yaml
# Добавить в /opt/beget/n8n/docker-compose.yml:
video-service:
  image: node:20-alpine
  working_dir: /app
  volumes:
    - /opt/video-service:/app
  command: sh -c "npm install && npm run build && npm start"
  env_file: /opt/video-service/.env.production
  ports:
    - "127.0.0.1:3001:3000"
  restart: always
  labels:
    - traefik.enable=true
    - traefik.http.routers.video.rule=Host(`video.yourdomain.com`)
    - traefik.http.routers.video.tls=true
    - traefik.http.routers.video.entrypoints=websecure
    - traefik.http.routers.video.tls.certresolver=mytlschallenge
```

### 5.2 .env.production на сервере

```env
NEXT_PUBLIC_SUPABASE_URL=https://xpnhydxwsbacuavcwmzb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIzaSy...
GROQ_API_KEY=gsk_...
HUGGINGFACE_TOKEN=hf_...
FAL_API_KEY=46262fea...
N8N_ASSEMBLE_WEBHOOK_URL=http://n8n:5678/webhook/video-assemble
NEXT_PUBLIC_APP_URL=https://video.yourdomain.com
```

> ⚠️ N8N_ASSEMBLE_WEBHOOK_URL использует внутреннее имя контейнера `n8n` (Docker network)

### 5.3 Домен

Либо:
- Купи домен (~150 руб/год на Beget)
- Или используй поддомен Beget типа `video-XXXX.beget.app`

---

## ЭТАП 6 — Cloudflare Pages (если нужен CDN)

Если всё-таки хочешь Cloudflare Pages:

### 6.1 Переменные окружения в Cloudflare Dashboard

Settings → Environment variables → Production:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
GROQ_API_KEY
HUGGINGFACE_TOKEN
FAL_API_KEY
N8N_ASSEMBLE_WEBHOOK_URL=https://koyiequoquulee.beget.app/webhook/video-assemble
NEXT_PUBLIC_APP_URL=https://your-project.pages.dev
CF_PAGES=1
```

### 6.2 next.config.ts для Cloudflare

Нужен пакет `@cloudflare/next-on-pages`:

```bash
npm install @cloudflare/next-on-pages
```

Добавить в `next.config.ts`:
```ts
import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}
```

### 6.3 Ограничения Cloudflare Pages Functions

| Route | Runtime | Работает? |
|-------|---------|-----------|
| /api/generate/script | edge | ✅ |
| /api/generate/frames | nodejs | ❌ timeout |
| /api/generate/video | nodejs | ❌ timeout |
| /api/generate/assemble | nodejs | ❌ child_process |
| /api/analyze/website | edge | ✅ |
| /api/storage/upload | nodejs | ⚠️ большие файлы |

**Вывод**: для Cloudflare нужна переработка архитектуры (Этап 4).

---

## ЭТАП 7 — Экономия баланса fal.ai ($6)

### 7.1 Считаем расходы

- 1 клип Kling v2 standard (5 сек) ≈ $0.145
- 5 клипов = $0.725 за один полный тест
- $6 / $0.725 ≈ **8 полных тестовых прогонов**

### 7.2 Как экономить

1. Тестируй с 1-2 сценами, не 5
2. Используй duration "5" вместо "10"
3. Не нажимай "Перегенерировать" без нужды

### 7.3 Бесплатная альтернатива видео (когда кончится)

В research файлах упоминался **Wan 2.1** — open source, можно запустить на GPU хостинге (Replicate, RunPod).

---

## ЭТАП 8 — Чеклист перед запуском

- [ ] Supabase bucket "videos" создан и публичный
- [ ] Тест Step 1-5 локально прошёл успешно
- [ ] fal.ai видео воспроизводятся
- [ ] n8n сборка работает (результат скачивается)
- [ ] next.config.ts содержит все CDN хосты
- [ ] .env.production готов на сервере
- [ ] Next.js задеплоен (VPS или Cloudflare)
- [ ] Домен настроен
- [ ] SSL сертификат работает

---

## Рекомендуемый порядок действий

1. **Сейчас**: проверь Supabase bucket (10 мин)
2. **Сейчас**: запусти полный тест Step 1-5 (45 мин)
3. **Если работает**: деплой на VPS через docker-compose (1 час)
4. **Потом**: рефакторинг под Cloudflare Pages (2-3 дня)

**Самый быстрый путь к рабочему продукту** = деплой на тот же Beget VPS где уже стоит n8n.
