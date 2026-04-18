# SETUP.md — Руководство разработчика

> Проект: ClipGen v2 — мультимодальная AI-платформа (клон SYNTX AI)
> Репозиторий: `clipgen-v2`
> Путь локально: `/Users/vagiz/Documents/Projects/video-service-v2/`
> Путь на сервере: `/opt/video-service-v2/`

---

## 1. Требования

| Компонент | Версия | Зачем |
|-----------|--------|-------|
| Node.js | 20.x (LTS) | Runtime, Dockerfile использует `node:20-alpine` |
| npm | 10+ | Lockfile v3, `--legacy-peer-deps` |
| Docker | 24+ | Контейнеризация всего стека |
| Docker Compose | v2+ | Оркестрация (postgres, redis, app, worker) |
| PostgreSQL | 16 | БД (в Docker — `postgres:16-alpine`) |
| Redis | 7 | Очереди BullMQ (в Docker — `redis:7-alpine`) |
| FFmpeg | 7.0+ | В worker-контейнере для монтажа видео |
| Git | 2.x | CI/CD (push → auto-deploy через GitHub Actions) |

**Для локальной разработки достаточно:** Node.js 20, Docker Desktop.

---

## 2. Локальная разработка

### 2.1. Клонирование и установка

```bash
git clone https://github.com/bigselle2014-netizen/clipgen-v2.git
cd clipgen-v2
npm install --legacy-peer-deps
```

### 2.2. Настройка .env

```bash
cp .env.example .env
```

Заполни значения. **Обязательные для запуска:**

| Переменная | Как получить | Обязательна? |
|------------|-------------|-------------|
| `POSTGRES_USER` | Любое, например `videofactory` | Да |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | Да |
| `DATABASE_URL` | `postgresql://videofactory:ПАРОЛЬ@localhost:5432/videofactory` | Да |
| `REDIS_PASSWORD` | `openssl rand -hex 32` | Да |
| `REDIS_URL` | `redis://:ПАРОЛЬ@localhost:6379` | Да |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | Да |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Да |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | Да |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Да |
| `GOOGLE_AI_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Да (сценарий) |
| `GROQ_API_KEY` | [Groq Console](https://console.groq.com/keys) | Да (quality gate) |

**Для полного pipeline (генерация видео):**

| Переменная | Провайдер | Для чего |
|------------|-----------|----------|
| `ATLAS_API_KEY` | [Atlas Cloud](https://atlas.ai) | Seedance 2.0 Pro — основная видеомодель |
| `FAL_KEY` | [fal.ai](https://fal.ai/dashboard/keys) | Seedance 1.5, Kling — fallback |
| `PIAPI_KEY` | [piapi.ai](https://piapi.ai) | Midjourney v7 — hero-кадры |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/keys) | Claude для сценариев |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) | Sora fallback |
| `PROXY_URL` | Прокси-провайдер | Runway/Sora/Veo3 (блокировка РФ) |

**Опциональные (пустые по умолчанию):**

| Переменная | Для чего |
|------------|----------|
| `ELEVENLABS_API_KEY` | Озвучка (10K символов/мес бесплатно) |
| `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY` | Платежи в рублях |
| `SENTRY_DSN` | Мониторинг ошибок |
| `LOGTAIL_SOURCE_TOKEN` | Структурированные логи |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 хранилище файлов |

### 2.3. Запуск PostgreSQL + Redis локально

**Вариант A: Docker (рекомендуется)**

Создай `docker-compose.dev.yml` в корне проекта:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: clipgen-dev-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: videofactory
      POSTGRES_USER: videofactory
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - pgdata_dev:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: clipgen-dev-redis
    restart: unless-stopped
    command: redis-server --requirepass devpassword --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_dev:/data

volumes:
  pgdata_dev:
  redis_dev:
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

В `.env` при этом:
```
POSTGRES_USER=videofactory
POSTGRES_PASSWORD=devpassword
DATABASE_URL=postgresql://videofactory:devpassword@localhost:5432/videofactory
REDIS_PASSWORD=devpassword
REDIS_URL=redis://:devpassword@localhost:6379
```

**Вариант B: Локальные PostgreSQL и Redis**

```bash
# macOS
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis

createdb videofactory
psql videofactory -c "CREATE USER videofactory WITH PASSWORD 'devpassword';"
psql videofactory -c "GRANT ALL PRIVILEGES ON DATABASE videofactory TO videofactory;"
```

### 2.4. Применение DB миграций

Проект использует **Drizzle ORM**. Схема определена в `src/lib/db/schema.ts`.

```bash
# Генерация SQL миграций из схемы
npm run db:generate

# Применение миграций к БД
npm run db:migrate

# Или push схемы напрямую (для dev — быстрее)
npm run db:push

# Drizzle Studio — визуальный просмотр БД
npm run db:studio
```

### 2.5. Запуск

```bash
# Next.js dev server (порт 3000)
npm run dev

# В отдельном терминале — BullMQ worker (обработка очередей генерации)
npm run worker:dev
```

Открыть: http://localhost:3000

---

## 3. Структура проекта

```
video-service-v2/
├── .env.example                    # Шаблон переменных окружения
├── .github/workflows/deploy.yml    # CI/CD: push → build Docker → deploy VPS
├── Dockerfile                      # Production образ Next.js (standalone)
├── Dockerfile.worker               # Worker образ (FFmpeg + BullMQ)
├── docker-compose.yml              # Production: app + worker + postgres + redis
├── drizzle.config.ts               # Конфиг Drizzle ORM
├── middleware.ts                    # Next.js middleware (auth, rate limit)
├── next.config.ts                  # Next.js конфиг (standalone output, security headers)
├── setup-server.sh                 # Скрипт первичной настройки VPS
│
├── scripts/
│   └── fix-db-production.sql       # SQL-патч для миграций на проде
│
├── src/
│   ├── app/
│   │   ├── (auth)/                 # Страницы auth: login, register, reset-password
│   │   ├── (dashboard)/            # Dashboard пользователя
│   │   ├── create/                 # Wizard создания видео (5 шагов)
│   │   │   ├── page.tsx
│   │   │   └── _components/
│   │   │       ├── CreatePageClient.tsx
│   │   │       └── WizardProgress.tsx
│   │   ├── api/
│   │   │   ├── auth/[...all]/      # Better Auth catch-all
│   │   │   ├── balances/           # Баланс токенов
│   │   │   ├── brand-kits/         # CRUD Brand Kit
│   │   │   ├── generate/
│   │   │   │   ├── assemble/       # FFmpeg монтаж (n8n webhook → fallback local)
│   │   │   │   ├── frames/         # Генерация ключевых кадров (Flux/MJ)
│   │   │   │   ├── script/         # Генерация сценария (Gemini → Quality Gate)
│   │   │   │   └── video/          # Генерация видео (Atlas → fal.ai fallback chain)
│   │   │   │       └── status/     # Polling статуса генерации
│   │   │   ├── health/             # Health check endpoint
│   │   │   ├── jobs/[id]/stream/   # SSE стриминг прогресса
│   │   │   └── projects/           # CRUD проектов
│   │   ├── layout.tsx
│   │   └── page.tsx                # Landing page
│   │
│   ├── components/
│   │   └── features/wizard/        # UI компоненты wizard
│   │       ├── BriefWizard.tsx     # Шаг 1: Бриф (подшаги Brand/Assets/Style)
│   │       ├── StepScript.tsx      # Шаг 2: Сценарий
│   │       ├── StepFrames.tsx      # Шаг 3: Ключевые кадры
│   │       ├── StepVideo.tsx       # Шаг 4: Видеоклипы
│   │       ├── StepResult.tsx      # Шаг 5: Монтаж и экспорт
│   │       └── brief/              # Подкомпоненты брифа
│   │           ├── BriefStepBrand.tsx
│   │           ├── BriefStepAssets.tsx
│   │           ├── BriefStepStyle.tsx
│   │           └── AssetUploadSlot.tsx
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── pipeline-guard.ts   # Pipeline guards (script, atlas payload, ffmpeg)
│   │   │   └── slop-filter.ts      # Anti-slop фильтр промтов
│   │   ├── auth/
│   │   │   ├── index.ts            # Better Auth серверная конфигурация
│   │   │   ├── client.ts           # Better Auth клиент
│   │   │   └── middleware.ts       # Auth middleware helper
│   │   ├── credits/
│   │   │   └── index.ts            # Hold/commit/rollback токенов
│   │   ├── db/
│   │   │   ├── index.ts            # Drizzle client (PostgreSQL)
│   │   │   └── schema.ts           # Схема БД (11 таблиц)
│   │   ├── middleware/
│   │   │   ├── rate-limit.ts       # Rate limiting (Redis-based)
│   │   │   └── validate.ts         # Zod валидация запросов
│   │   ├── providers/
│   │   │   ├── adapters/
│   │   │   │   ├── atlas.ts        # Atlas Cloud адаптер (Seedance 2.0)
│   │   │   │   └── fal.ts          # fal.ai адаптер (Seedance 1.5, Kling)
│   │   │   ├── chain.ts            # Fallback chain: Atlas → fal → ...
│   │   │   └── types.ts            # Типы провайдеров
│   │   ├── queue/
│   │   │   ├── index.ts            # BullMQ queue (добавление задач)
│   │   │   └── worker.ts           # BullMQ worker (обработка задач)
│   │   ├── redis/
│   │   │   └── index.ts            # ioredis singleton
│   │   └── storage/
│   │       └── index.ts            # Cloudflare R2 (S3-совместимый)
│   │
│   ├── store/
│   │   ├── wizard-store.ts         # Zustand store для wizard
│   │   └── job-store.ts            # Zustand store для job tracking
│   │
│   └── workers/
│       └── video-worker.ts         # BullMQ worker entry point
│
└── public/                         # Статика (favicon, images)
```

---

## 4. База данных

### 4.1. Схема (11 таблиц, Drizzle ORM)

Определена в `src/lib/db/schema.ts`:

| Таблица | Назначение | Ключевые поля |
|---------|-----------|---------------|
| `users` | Пользователи (Better Auth) | id, email, name, emailVerified |
| `sessions` | Сессии auth | userId, token, expiresAt |
| `accounts` | OAuth аккаунты | userId, providerId, accountId |
| `verifications` | Email подтверждения | identifier, value, expiresAt |
| `user_profiles` | Профиль + биллинг | plan (free/starter/pro/profi/studio), creditsBalance, creditsReserved, dailySpendingCap |
| `projects` | Wizard проекты | userId, status (draft→completed), brief (JSONB), script (JSONB) |
| `scenes` | Сцены проекта | projectId, sceneNumber, visualPrompt, keyframeUrl, videoClipUrl |
| `generation_jobs` | Очередь генераций | projectId, sceneId, jobType, status, provider, idempotencyKey |
| `brand_kits` | Brand Kit пользователя | userId, name, data (JSONB) |
| `cost_events` | Холд/коммит/откат токенов | userId, jobId, type (hold/commit/rollback), amount |
| `credits_ledger` | Журнал транзакций | userId, type (purchase/spend/refund/bonus), amount, balanceBefore/After |
| `payments` | Платежи YooKassa | userId, amount, currency (RUB), externalId, creditsGranted |

### 4.2. Enums

- `plan`: free, starter, pro, profi, studio
- `project_status`: draft, brief, script, frames, video, result, completed, failed
- `scene_status`: pending, generating, completed, failed
- `job_type`: keyframe, video_clip, voiceover, assemble
- `job_status`: pending, in_queue, in_progress, completed, failed, cancelled
- `cost_event_type`: hold, commit, rollback
- `ledger_type`: purchase, spend, refund, bonus, hold, hold_release
- `payment_status`: pending, succeeded, failed, cancelled, refunded

### 4.3. Команды миграций

```bash
# Генерировать SQL из schema.ts
npm run db:generate

# Применить к БД
npm run db:migrate

# Push напрямую (dev only — без миграций)
npm run db:push

# Визуальный просмотр
npm run db:studio
```

### 4.4. Seed данные

После первого `db:push` выполнить вручную:

```sql
-- Тарифные планы (начальные данные для user_profiles)
-- Создаются автоматически при регистрации через Better Auth trigger.
-- Дефолт: plan=free, credits_balance=100, daily_spending_cap=50
```

Конфигурации моделей (`model_configs`) пока хранятся в коде (`src/lib/providers/`), а не в БД. Перенос в БД — фаза 2.

---

## 5. Деплой на VPS 155.212.141.8

### 5.1. SSH подключение

```bash
ssh root@155.212.141.8
```

### 5.2. Структура файлов на сервере

```
/opt/video-service-v2/
├── .env                    # Production переменные (НЕ в git!)
├── docker-compose.yml      # Из репозитория (git pull)
├── Dockerfile
├── Dockerfile.worker
├── scripts/
│   └── fix-db-production.sql
└── ... (весь репозиторий)
```

### 5.3. Docker Compose — Production

Файл `docker-compose.yml` в репозитории уже настроен:

**Сервисы:**

| Сервис | Образ | Порт | Назначение |
|--------|-------|------|-----------|
| `app` | `ghcr.io/.../app:latest` | 3000 (внутренний) | Next.js приложение |
| `worker` | `ghcr.io/.../worker:latest` | — | BullMQ worker + FFmpeg |
| `postgres` | `postgres:16-alpine` | 5432 (внутренний) | База данных |
| `redis` | `redis:7-alpine` | 6379 (внутренний) | Очереди + кэш |

**Сети:**
- `traefik` (external) — для Traefik reverse proxy
- `internal` (bridge) — связь между контейнерами

**Volumes:**
- `postgres_data` — данные PostgreSQL
- `redis_data` — данные Redis (AOF persistence)

**Важно:** `DATABASE_URL` и `REDIS_URL` переопределяются в `environment:` секции docker-compose — используются имена сервисов (`postgres`, `redis`) вместо `localhost`.

### 5.4. Traefik конфиг (на VPS)

Traefik должен быть установлен отдельно на VPS как общий reverse proxy. Минимальный `docker-compose.traefik.yml`:

```yaml
services:
  traefik:
    image: traefik:v3
    container_name: traefik
    restart: unless-stopped
    command:
      - --api.dashboard=false
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.mytlschallenge.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.mytlschallenge.acme.email=${ACME_EMAIL:-admin@clipgen.ru}
      - --certificatesresolvers.mytlschallenge.acme.storage=/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_acme:/acme.json
    networks:
      - traefik

volumes:
  traefik_acme:

networks:
  traefik:
    name: traefik
    driver: bridge
```

SSL для `clipgen.ru` настраивается автоматически через Traefik labels в `docker-compose.yml`:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.videofactory.rule=Host(`clipgen.ru`)
  - traefik.http.routers.videofactory.entrypoints=websecure
  - traefik.http.routers.videofactory.tls.certresolver=mytlschallenge
  - traefik.http.services.videofactory.loadbalancer.server.port=3000
```

### 5.5. .env на сервере

Файл `/opt/video-service-v2/.env` — создать вручную. Обязательные переменные:

```bash
# === ОБЯЗАТЕЛЬНЫЕ (без них сервис не запустится) ===
NEXT_PUBLIC_APP_URL=https://clipgen.ru
DOMAIN=clipgen.ru
ACME_EMAIL=admin@clipgen.ru

POSTGRES_USER=videofactory
POSTGRES_PASSWORD=<openssl rand -hex 32>
DATABASE_URL=postgresql://videofactory:ПАРОЛЬ@postgres:5432/videofactory

REDIS_PASSWORD=<openssl rand -hex 32>
REDIS_URL=redis://:ПАРОЛЬ@redis:6379

BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=https://clipgen.ru

ENCRYPTION_KEY=<openssl rand -hex 32>

# === AI ПРОВАЙДЕРЫ (обязательные для генерации) ===
GOOGLE_AI_KEY=<ключ>
GROQ_API_KEY=<ключ>
ATLAS_API_KEY=<ключ>          # Atlas Cloud (Seedance 2.0)
FAL_KEY=<ключ>                # fal.ai (fallback)

# === ДОПОЛНИТЕЛЬНЫЕ (для полного pipeline) ===
OPENROUTER_API_KEY=<ключ>     # Claude для сценариев
OPENAI_API_KEY=<ключ>         # Sora fallback
PIAPI_KEY=<ключ>              # Midjourney v7
PROXY_URL=<http://user:pass@proxy:port>  # Для Runway/Sora/Veo3 из РФ

# === n8n ===
N8N_ASSEMBLE_WEBHOOK_URL=https://koyiequoquulee.beget.app/webhook/video-assemble

# === ОПЦИОНАЛЬНЫЕ ===
ELEVENLABS_API_KEY=
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
SENTRY_DSN=
LOGTAIL_SOURCE_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=clipgen-files
R2_PUBLIC_URL=https://files.clipgen.ru
```

### 5.6. Первичная настройка сервера

```bash
# С локальной машины:
bash setup-server.sh <пароль-root>
```

Скрипт `setup-server.sh`:
1. Добавляет deploy key для GitHub Actions
2. Клонирует репозиторий в `/opt/video-service-v2/`
3. Восстанавливает `.env` если есть
4. Запускает `docker compose up -d --build`

### 5.7. Команды деплоя

**Автоматический деплой (рекомендуется):**

```bash
# Любой push в main → GitHub Actions → build Docker → deploy VPS
git push origin main
```

CI/CD pipeline (`.github/workflows/deploy.yml`):
1. Build Docker images (app + worker)
2. Push в GitHub Container Registry (GHCR)
3. SSH на VPS → `docker compose pull` → `docker compose up -d`
4. Health check: ждёт `/api/health` 200 (до 30 сек)

**Ручной деплой (если CI/CD не работает):**

```bash
ssh root@155.212.141.8
cd /opt/video-service-v2
git pull origin main
docker compose pull app worker
docker compose up -d --no-deps --force-recreate app worker
docker image prune -af
```

**GitHub Actions Secrets (настроить в репозитории):**

| Secret | Значение |
|--------|---------|
| `DEPLOY_HOST` | `155.212.141.8` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_KEY` | SSH private key (ed25519) |

---

## 6. n8n интеграция

### 6.1. Endpoint

- URL: `https://koyiequoquulee.beget.app/`
- Webhook: `https://koyiequoquulee.beget.app/webhook/video-assemble`

### 6.2. Как работает

1. `POST /api/generate/assemble` на бэкенде формирует payload и отправляет POST на `N8N_ASSEMBLE_WEBHOOK_URL`
2. n8n workflow получает данные (клипы, музыка, озвучка, настройки монтажа)
3. n8n запускает FFmpeg: склейка клипов + transitions + color grade + audio mix
4. n8n загружает результат в storage и отвечает с URL
5. Если n8n недоступен — fallback на локальный FFmpeg в worker-контейнере

### 6.3. Webhook payload

```json
{
  "projectId": "...",
  "clips": [
    { "url": "https://...", "duration": 5 },
    { "url": "https://...", "duration": 5 }
  ],
  "musicUrl": "https://...",
  "voiceoverUrl": "https://...",
  "colorGrade": "luxury",
  "transitions": "smart",
  "aspectRatio": "9:16"
}
```

### 6.4. Настройка workflow в n8n

1. Открыть https://koyiequoquulee.beget.app/
2. Создать Workflow → добавить Webhook Trigger (path: `video-assemble`, method: POST)
3. Добавить Execute Command node → FFmpeg команда
4. Добавить HTTP Response node → вернуть URL результата

---

## 7. Чеклист первого деплоя

### Подготовка

- [ ] Репозиторий `clipgen-v2` создан на GitHub
- [ ] GitHub Actions Secrets настроены: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`
- [ ] DNS: `clipgen.ru` → A-запись → `155.212.141.8`
- [ ] DNS: `files.clipgen.ru` → CNAME → Cloudflare R2 (если используется)

### Сервер

- [ ] SSH доступ к `root@155.212.141.8` работает
- [ ] Docker + Docker Compose установлены
- [ ] Traefik запущен и работает (docker network `traefik` создана)
- [ ] `setup-server.sh` выполнен — репозиторий склонирован в `/opt/video-service-v2/`
- [ ] `.env` файл создан и заполнен на сервере

### База данных

- [ ] PostgreSQL контейнер запущен и healthy
- [ ] Миграции применены (`npm run db:push` или SQL через `scripts/fix-db-production.sql`)
- [ ] Таблицы созданы (проверить: `docker compose exec postgres psql -U videofactory -d videofactory -c '\dt'`)

### Приложение

- [ ] `docker compose up -d` — все 4 контейнера running
- [ ] Health check: `curl -s https://clipgen.ru/api/health` → 200 OK
- [ ] SSL: `curl -sI https://clipgen.ru` → `HTTP/2 200`, certificate valid
- [ ] Регистрация/логин через Better Auth работает
- [ ] Wizard (/create) открывается

### AI Pipeline

- [ ] `GOOGLE_AI_KEY` работает (тест: генерация сценария)
- [ ] `ATLAS_API_KEY` работает (тест: генерация 5-сек видео)
- [ ] `FAL_KEY` работает (тест: fallback генерация)
- [ ] `GROQ_API_KEY` работает (тест: quality gate)
- [ ] n8n webhook доступен: `curl -s https://koyiequoquulee.beget.app/healthz`

### Безопасность

- [ ] API ключи НЕ в `NEXT_PUBLIC_*` переменных
- [ ] `.env` НЕ в git (проверить `.gitignore`)
- [ ] Rate limiting работает (middleware.ts)
- [ ] Security headers присутствуют (X-Frame-Options, X-Content-Type-Options)

### Мониторинг (рекомендуется сразу)

- [ ] UptimeRobot / Hetrixtools → ping `https://clipgen.ru/api/health` каждые 60 сек
- [ ] Telegram алерт при downtime
- [ ] Бэкап PostgreSQL: `pg_dump` в cron каждые 24ч
- [ ] Docker log rotation: `max-size: 50m, max-file: 5` в daemon.json

---

## 8. Полезные команды

```bash
# === Локально ===
npm run dev                          # Dev server
npm run worker:dev                   # Worker с hot-reload
npm run build                        # Production build
npm run db:studio                    # Визуальная БД
npx tsc --noEmit --skipLibCheck      # Проверка типов

# === На сервере ===
ssh root@155.212.141.8
cd /opt/video-service-v2

docker compose ps                    # Статус контейнеров
docker compose logs app --tail 100   # Логи приложения
docker compose logs worker --tail 100 # Логи worker
docker compose logs postgres --tail 50 # Логи БД
docker compose restart app worker    # Рестарт без ребилда
docker compose exec postgres psql -U videofactory -d videofactory  # SQL shell

# Ручной бэкап БД
docker compose exec postgres pg_dump -U videofactory videofactory | gzip > backup_$(date +%Y%m%d).sql.gz

# Проверка диска
df -h

# Проверка Docker
docker system df
docker image prune -af               # Очистка старых образов
```
