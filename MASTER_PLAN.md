# AI Video Factory — Мастер-план
> Последнее обновление: 9 апреля 2026
> Принцип: эталонное решение без вариантов, $0-25/мес

---

## АРХИТЕКТУРА (финальная)

```
Пользователь
    ↓
[Next.js на Beget VPS] — три пути входа
    ↓
[AI Router] → Gemini Flash-Lite / Flash / Flash-2.5
    ↓
[Quality Gate] → Groq LLaMA 70b судья (cross-provider)
    ↓
[SSE progress stream] → клиент видит прогресс в реальном времени
    ↓
[n8n на том же VPS] → тяжёлые задачи (FFmpeg, Seedance, сборка)
    ↓
[Supabase Storage] → финальные файлы
```

---

## ФАЗА 0 — Запуск MVP (3-4 дня)

### 0.1 Инфраструктура Supabase
- [ ] Bucket `videos` → публичный, политика "allow all"
- [ ] Bucket `assets` → для загрузки брендовых ассетов (@Image1-3)
- [ ] Таблица `projects` (id, brand_name, status, created_at)
- [ ] Таблица `tasks` (id, project_id, type, status, result, error)

### 0.2 Исправить next.config.ts
```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "**.fal.run" },
    { protocol: "https", hostname: "**.fal.media" },
    { protocol: "https", hostname: "v3.fal.media" },
    { protocol: "https", hostname: "xpnhydxwsbacuavcwmzb.supabase.co" },
  ]
}
```

### 0.3 Тест Steps 1-5 локально
- Бренд Befree, 2 сцены (экономия fal.ai)
- Проверить: кадры видны, видео играет, финал скачивается

### 0.4 Деплой на Beget VPS
```yaml
# Добавить в /opt/beget/n8n/docker-compose.yml
video-service:
  image: node:20-alpine
  working_dir: /app
  volumes:
    - /opt/video-service:/app
  command: sh -c "npm ci && npm run build && npm start"
  env_file: /opt/video-service/.env.production
  ports:
    - "127.0.0.1:3001:3000"
  restart: always
  labels:
    - traefik.enable=true
    - traefik.http.routers.video.rule=Host(`video.koyiequoquulee.beget.app`)
    - traefik.http.routers.video.tls=true
    - traefik.http.routers.video.entrypoints=websecure
    - traefik.http.routers.video.tls.certresolver=mytlschallenge
```

---

## ФАЗА 1 — SSE + Три пути входа (неделя 2)

### 1.1 SSE прогресс (КРИТИЧНО)
Пользователь не должен смотреть в пустой экран 5 минут.

Новый маршрут: `GET /api/generate/[taskId]/stream` — Server-Sent Events
```
data: {"step":"script","status":"done","progress":20}
data: {"step":"frames","status":"processing","progress":40}
data: {"step":"video","status":"processing","scene":2,"of":5,"progress":65}
data: {"step":"assemble","status":"done","videoUrl":"https://...","progress":100}
```

Клиент: `useEventSource(url)` хук, обновляет UI без polling.

### 1.2 Три пути входа — новый API `/api/intake/classify`

**Путь 1: Полный пакет**
- Есть ТЗ + ассеты (фото модели, продукта, лого)
- Система проверяет полноту, задаёт 1-2 уточнения
- Сразу к генерации

**Путь 2: Есть идея**
- Написал словами что хочет, нет ассетов
- Система задаёт 3-5 умных вопросов (task: `questions`)
- Генерирует ассеты через Flux

**Путь 3: "Сделай сам"**
- Только название/URL бренда
- Система: анализирует URL → ДНК бренда → находит референсы → предлагает 3 концепции → пользователь выбирает
- Полностью автономная генерация

### 1.3 Умные вопросы (task: `questions` + quality gate)
Не "какое настроение?" а конкретные:
- "Снимаем для Reels (9:16) или YouTube (16:9)?"
- "Есть фото модели или генерируем ИИ-персонажа?"
- "Покажи ролик который нравится — ссылка или опиши"
- "Что должен сделать зритель после просмотра?"
- "Есть запрещённые цвета/образы (цвета конкурентов и т.д.)?"

### 1.4 Загрузка ассетов + автоанализ
При загрузке @Image1-3 → Gemini Vision анализирует:
- Извлекает цвета (HEX палитра)
- Определяет стиль (минимализм / яркий / editorial)
- Подтверждает: "Вижу логотип Nike, фото девушки 20-25 лет, белый фон — верно?"
Результат автоматически уходит в бриф

---

## ФАЗА 2 — Brand Kit + Шаблоны + Одобрение (неделя 3)

### 2.1 Brand Kit
Supabase таблица `brand_kits`:
```sql
CREATE TABLE brand_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,  -- после добавления auth
  name TEXT NOT NULL,
  logo_url TEXT,
  colors TEXT[],           -- ["#FF5733", "#C0C0C0"]
  mood TEXT,
  tone_of_voice TEXT,
  target_audience TEXT,
  industry TEXT,
  forbidden_elements TEXT, -- что нельзя показывать
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
UI: создать / выбрать при старте → поля брифа заполняются сами

### 2.2 Шаблоны ниш
6 файлов в `/src/lib/templates/`:
- `fashion.ts` — 5 сцен: lifestyle + product + detail + emotion + CTA
- `cosmetics.ts` — акцент крупные планы, skin texture, before/after
- `food.ts` — slow motion, texture shots, hands
- `music.ts` — performance + atmosphere + crowd reaction
- `tech.ts` — product demo + feature highlights + testimonial
- `real_estate.ts` — walkthrough + detail + lifestyle

Каждый шаблон: структура сцен + типичные cameraMovements + стиль + цветовая палитра

### 2.3 Референс-видео
Пользователь вставляет ссылку TikTok/Reels/YouTube.
Gemini Flash анализирует страницу по URL → извлекает:
- Темп (быстрый <2сек/кадр / медленный >4сек)
- Стиль (editorial / commercial / documentary / музыкальный клип)
- Доминирующие планы (крупный / средний / широкий)
- Цветовая тональность (тёплая / холодная / нейтральная / высококонтрастная)

Результат = параметры для `styleContext` в промте сценариста

### 2.4 Одобрение на каждом шаге
После каждого этапа пользователь видит результат и выбирает:
- ✅ Одобрить → следующий шаг
- ✏️ Изменить → редактирует конкретный элемент
- 🔄 Перегенерировать эту сцену → только одну, не всё

---

## ФАЗА 3 — Субтитры + Озвучка + Мультиформат (неделя 4)

### 3.1 Субтитры (опционально, галочка)
Технический путь:
1. Whisper (HuggingFace Inference API, бесплатно) → транскрипция аудио/нарратива
2. Генерация `.srt` файла
3. FFmpeg: `drawtext` фильтр или `subtitles` фильтр с ASS форматом

Шрифты (5 вариантов, все протестированы на кириллице):
- Montserrat Bold — современный, Instagram
- Impact — агрессивный, TikTok-стиль
- Playfair Display — люкс, editorial
- Oswald — спорт, энергия
- PT Sans — нейтральный, универсальный

Важно: шрифты (.ttf) хранить на сервере в `/opt/video-service/fonts/`
FFmpeg команда: `-vf "subtitles=sub.srt:force_style='FontName=Montserrat,FontSize=24,PrimaryColour=&H00FFFFFF,BorderStyle=3,OutlineColour=&H00000000,Outline=2'"`

Позиция: снизу (default) / по центру (option)

### 3.2 Озвучка (опционально)
Технический путь:
1. LLM генерирует текст озвучки из сценария (task: `script`, 30-60 слов)
2. ElevenLabs API → MP3 (10K символов/мес бесплатно)
3. FFmpeg в n8n: микшируем voice-over + фоновая музыка (-4dB) → финальное видео

Варианты голоса: мужской деловой / женский рекламный / нейтральный
Стиль подачи: рекламный (энергичный) / documentary (спокойный) / дружелюбный
Громкость: voice -0dB, music -12dB (стандарт рекламы)

### 3.3 Мультиформат (n8n workflow)
После сборки основного видео — автоматически три формата:
- 9:16: `ffmpeg -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2"`
- 16:9: оригинал
- 1:1: `ffmpeg -vf "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2"`

---

## ФАЗА 4 — RAG + Самообучение (месяц 2)

### 4.1 Feedback loop
После просмотра финального видео:
```sql
CREATE TABLE prompt_feedback (
  id UUID PRIMARY KEY,
  scene_prompt TEXT,
  visual_result_url TEXT,
  score INTEGER,  -- 1 (плохо) / 3 (нейтрально) / 5 (отлично)
  industry TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 pgvector RAG
- Supabase включает pgvector extension бесплатно
- Embed промты через Gemini Embedding API (бесплатно до лимита)
- При генерации: находим top-3 похожих успешных промта → вставляем как примеры в system prompt
- Результат: система учится на реальных успешных примерах

### 4.3 Мониторинг (Langfuse self-hosted)
Трекать каждый LLM-вызов:
- model, task, tokens_in, tokens_out, latency, quality_score
- Видеть: какие промты дают плохой результат
- Автоалерт если quality_score < 70 три раза подряд

---

## ФАЗА 5 — Монетизация (месяц 3)

### Auth
Supabase Auth: email/password + Google OAuth
Middleware защищает все `/api/generate/*` роуты

### Тиры
| Тир | Цена | Лимиты |
|-----|------|--------|
| Free | $0 | 2 ролика/мес, водяной знак, 1 Brand Kit |
| Pro | $29/мес | 20 роликов, все функции, 5 Brand Kit'ов |
| Agency | $99/мес | безлимит, API доступ, клиентский шеринг |

### Оплата
- ЮKassa для РФ (robokassa как fallback)
- Stripe для международных

---

## ТЕХНИЧЕСКИЕ РЕШЕНИЯ — ВАЖНЫЕ ДЕТАЛИ

### Частичное восстановление при ошибках
Если сцена N упала → не теряем остальные:
```ts
const results = await Promise.allSettled(scenes.map(generate))
const successful = results.filter(r => r.status === "fulfilled")
// Минимум 3 из 5 сцен → идём дальше, показываем warning
```

### Rate limiting
`/api/generate/*` — 10 запросов/мин на IP (без auth)
Реализация: Upstash Redis + `@upstash/ratelimit` (бесплатный тир)

### Сжатие контекста диалога
Никогда не гоним полную историю переписки в LLM.
Только сжатое резюме: `{ brand, style, chosen_concept, assets_uploaded: bool }`
Экономия: 60-80% токенов на длинных сессиях

### Семантический кэш
Похожий бриф → кэшируем сценарий на 24 часа.
Upstash Redis: ключ = hash(brandName + mood + videoType), TTL = 86400
Экономия: ~$3-5/мес при 100+ пользователях

---

## ПОСТОЯННЫЕ РАСХОДЫ

| Сервис | Тариф | Стоимость |
|--------|-------|-----------|
| Beget VPS | уже есть | 0 ₽ |
| SYNTX | Basic | 890 ₽/мес |
| fal.ai (Kling v2) | по расходу | ~$5-15/мес |
| Supabase | Free | $0 |
| Gemini API | Free tier | $0 |
| Groq API | Free tier | $0 |
| ElevenLabs | Free (10K chars) | $0 |
| Whisper (HuggingFace) | Free | $0 |
| Upstash Redis | Free (10K req/день) | $0 |
| Langfuse | Self-hosted | $0 |
| **ИТОГО** | | **~$10-25/мес** |

---

## ЧЕКЛИСТ ГОТОВНОСТИ К ЗАПУСКУ

- [ ] Supabase bucket создан и публичный
- [ ] Steps 1-5 прошли локально
- [ ] Деплой на VPS, домен работает, SSL активен
- [ ] SSE прогресс стримит статус клиенту
- [ ] Quality gate: скрипт получает score ≥ 85
- [ ] Три пути входа работают
- [ ] Brand Kit сохраняется и применяется
- [ ] Субтитры: кириллица без кракозябр
- [ ] Озвучка: микшируется корректно
- [ ] Мультиформат: три файла на выходе
- [ ] Rate limiting активен
- [ ] Langfuse пишет трейсы

---

## ПОРЯДОК ДЕЙСТВИЙ (сейчас)

1. **Сегодня**: Тест пайплайна локально, убедиться что Steps 1-5 работают
2. **Завтра**: Деплой на VPS
3. **Неделя 2**: SSE + три пути входа + загрузка ассетов
4. **Неделя 3**: Brand Kit + шаблоны + одобрение
5. **Неделя 4**: Субтитры + озвучка + мультиформат
6. **Месяц 2**: RAG + самообучение
7. **Месяц 3**: Auth + монетизация
