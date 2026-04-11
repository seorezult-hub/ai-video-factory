# Script System Design — AI Video Factory

**Версия:** 1.0
**Дата:** 11 апреля 2026
**Автор:** Product Architect
**Статус:** Design Proposal → Implementation Target

Документ описывает архитектуру системы генерации сценариев для AI Video Factory. Цель — превратить хаотичный LLM-вывод в предсказуемый, совместимый с пайплайном production-ready сценарий, который гарантированно проходит все этапы генерации (Seedance Atlas → FFmpeg → Export) без ручных правок.

---

## 1. Проблема (почему текущий подход плох)

### 1.1 Что происходит сейчас
Текущий flow (`/api/generate/script/route.ts`):
1. Принимаем бриф (brand, mood, images, duration).
2. Отправляем огромный SYSTEM_PROMPT (~200 строк) в Claude Sonnet / Groq.
3. Получаем JSON-массив сцен.
4. Zod validation → `guardScript` auto-repair → возврат клиенту.

`guardScript` тушит симптомы, но не предотвращает причины:
- Обрезает промты >150 слов (значит LLM регулярно их пишет).
- Заменяет NSFW слова постфактум (значит LLM их генерирует).
- Добавляет `@Image4 brand logo` в последнюю сцену (значит LLM про него забывает).
- Нормализует `@image1` → `@Image1` (значит LLM не стабилен в написании тегов).

### 1.2 Конкретные проблемы текущей генерации

| Проблема | Причина | Последствие |
|---|---|---|
| Generic промты ("beautiful lighting", "cinematic atmosphere") | LLM экономит токены на абстракциях | Seedance игнорирует → средний результат |
| Длина сцены `"5 sec"` vs Atlas API ждёт `5` | Нет контракта на формат | Падение в `guardAtlasPayload`, ручной parseInt |
| `@Image6` в промте когда загружено 2 фото | LLM не знает сколько slots реально есть | Orphaned tag → Seedance рендерит мусор |
| Русский текст в `visualPrompt` | LLM иногда копирует из `descriptionRu` | Seedance деградирует (тренировался на EN) |
| Промт >200 слов | LLM хочет быть "подробным" | Seedance читает первые ~80 слов, остальное отбрасывает |
| Все сцены по 5 секунд | LLM выбирает безопасный дефолт | Монотонный ритм, нет динамики |
| NSFW-триггеры в fitness/cosmetics ("skin", "body", "tight") | LLM не знает про NSFW фильтр Atlas | Atlas возвращает ошибку → fallback на fal.ai (дороже и хуже) |
| Переходы не согласованы между сценами | SYSTEM_PROMPT описывает match cuts, но LLM про них "забывает" на сцене 3+ | Визуальные скачки при сборке в FFmpeg |
| Последняя сцена без логотипа | LLM закончил "эмоционально" | `guardScript` вкорячивает `@Image4 brand logo held on screen` — выглядит как заплатка |
| `cameraMovement: "slow zoom into the product"` | LLM не держит enum | `validateScriptQuality` бракует, но уже поздно |

### 1.3 Почему LLM без контекста даёт generic
**LLM оптимизируется на "правдоподобие токенов", не на "работоспособность с API"**. Без жёстких constraints:
1. Он усредняет обучающую выборку → получает generic рекламу.
2. Он не знает нюансов конкретной модели (Seedance 2.0 хочет именно такой формат).
3. Он не видит ограничений нижестоящих шагов (FFmpeg transitions, NSFW filter).
4. Он не помнит сколько реально `@Image` slots доступно.
5. Он смешивает задачи: "придумать историю" + "написать технический промт" → обе страдают.

**Вывод**: нужно разделить "придумывание истории" (креатив) и "технический промт для модели" (инжиниринг), а между ними поставить валидатор совместимости.

---

## 2. Анализ рынка (лучшие решения)

### 2.1 Runway ML (Gen-4 + Act-Two)
**Как делают:** UI-билдер сцен. Пользователь сам выбирает камеру/движение из списка. LLM только enrichment описания.
**Плюсы:** Предсказуемо, нет "галлюцинаций" промтов. Camera movements = enum, всегда валидны.
**Минусы:** Нужно вручную собирать сцены, нет автоматической нарративной арки. Для B2C пользователей (наша ЦА) это слишком сложно.

### 2.2 HeyGen
**Как делают:** Шаблоны скриптов под нишу (продажи, обучение, соцсети) + LLM вписывает бренд.
**Плюсы:** Быстро, для non-creative пользователей работает.
**Минусы:** Шаблоны "avatar talking" — не подходят для брендовых роликов без ведущего.

### 2.3 Pika Labs
**Как делают:** Свободный text-to-video, почти без structure. Pika handles short clips, не видео с нарративом.
**Плюсы:** Максимальная свобода.
**Минусы:** Нет сценария как концепции. Каждый клип изолирован. Не масштабируется на 30-60 сек рекламу.

### 2.4 Krea AI
**Как делают:** Real-time image → video. LLM ассистент "доводит" промт пользователя, но не пишет сценарий.
**Плюсы:** Итеративная работа с кадром.
**Минусы:** Нет pipeline для многосценного ролика.

### 2.5 Luma Dream Machine
**Как делают:** Keyframe-driven. Пользователь задаёт старт/конец, LLM прописывает interpolation.
**Плюсы:** Cinematic motion благодаря keyframe-подходу.
**Минусы:** Нет автоматической генерации брифа → сценария. Только визуальная интерполяция.

### 2.6 Sora (OpenAI)
**Как делают:** Один мощный prompt → сцена до 60 сек. LLM делает автоматический prompt rewrite из короткого ввода.
**Плюсы:** Длинные непрерывные сцены, качество топ.
**Минусы:** Закрытая платформа, нет доступа по API в production. Нет multi-image reference как у Seedance.

### 2.7 Kling 2.1 / Kling Master
**Как делают:** Template-driven + LLM. Шаблоны "music video", "commercial", "portrait".
**Плюсы:** Understanding of motion physics.
**Минусы:** Лимит 10 сек per clip — нужна сборка FFmpeg как у нас, но без гарантированных transition tools.

### 2.8 Наше конкурентное преимущество

| Фактор | Мы | Конкуренты |
|---|---|---|
| Multi-image reference (`@Image1..9`) | ✅ Seedance 2.0 native | ❌ только Sora частично |
| До 15 сек continuous shot | ✅ Atlas Seedance 2.0 | ❌ Kling/Pika = 10 max |
| Auto-репейр сценария (pipeline-guard) | ✅ Уникально | ❌ никто не делает |
| Встроенный NSFW sanitizer под Atlas | ✅ Уникально | ❌ все словят ошибку от Atlas |
| Нарративные шаблоны по нишам | ✅ В SYSTEM_PROMPT | Частично (HeyGen) |
| Quality gate (cross-provider judge) | ✅ Groq 70b | ❌ все верят своему LLM |
| Русский язык UX | ✅ | Частично |

**Стратегия:** Мы не пытаемся быть "Runway для всех". Мы — "Dior-квалити ролики за 5 минут для малого бренда". Качество над гибкостью.

---

## 3. Матрица совместимости (КЛЮЧЕВАЯ ЧАСТЬ)

Эта таблица — контракт между **что LLM может сгенерировать** и **что pipeline реально поддерживает**.

### 3.1 Длина сцен × модели

| Длина сцены | Atlas Seedance 2.0 | fal.ai Seedance 1.5 | fal.ai Kling 2.1 | FFmpeg assembly | Вердикт |
|---|---|---|---|---|---|
| 3 сек | ❌ не поддерживает | ❌ min 5 | ❌ min 5 | ✅ | **Никогда** |
| 5 сек | ✅ | ✅ | ✅ | ✅ | **Safe default** |
| 6–7 сек | ❌ округлит до 5 или 8 | ❌ округлит до 5 или 10 | ❌ | ⚠️ | **Запретить — неявный retime** |
| 8 сек | ✅ | ❌ → 10 | ❌ → 10 | ✅ | **OK только для Atlas** |
| 10 сек | ✅ | ✅ | ✅ | ✅ | **Safe** |
| 12 сек | ❌ → 10 или 15 | ❌ | ❌ | ⚠️ | **Запретить** |
| 15 сек | ✅ continuous | ❌ max 10 | ❌ max 10 | ⚠️ если 1 сцена — нет сборки | **Только Atlas + 15-single mode** |
| >15 сек | ❌ | ❌ | ❌ | — | **Никогда** |

**Фикс в генерации:** `duration` должен быть **enum** `5 | 8 | 10 | 15` строго. LLM не имеет права писать `"7 sec"`, `"12 sec"`. Zod schema: `z.enum(["5","8","10","15"])`.

### 3.2 `@Image` теги × количество реально загруженных

| Кол-во загруженных | Разрешённые теги | Что запрещено | Почему |
|---|---|---|---|
| 0 | Никаких `@Image` | Любые `@ImageN` | Orphaned → Seedance рендерит мусор |
| 1 | `@Image1` | `@Image2..9` | Атлас не увидит несуществующих |
| 2 | `@Image1`, `@Image2` | `@Image3..9` | — |
| 3 | `@Image1..3` | `@Image4..9` | В последней сцене **логотипа НЕТ** — надо рисовать текст |
| 4 | `@Image1..4` | `@Image5..9` | **Минимум для полноценного ролика** (hero, product front, product back, logo) |
| 5 | `@Image1..5` | `@Image6..9` | — |
| 6+ | `@Image1..6` | `@Image7..9` | Текущая UI капает на 6 |

**Фикс:** LLM получает в user-message **явный список доступных слотов** с ролями:
```
Available image slots:
@Image1 = hero/model (face)
@Image2 = product front
@Image4 = brand logo
(Slots 3,5,6 NOT PROVIDED — do not use)
```

Валидатор после генерации делает regex `/@Image([1-9])/g` и проверяет что каждый использованный номер ∈ доступных.

### 3.3 Язык промта × качество Seedance

| Язык `visualPrompt` | Seedance 2.0 результат | Seedance 1.5 |
|---|---|---|
| English (canonical) | ★★★★★ | ★★★★☆ |
| English + русские названия ("Moscow", "Красная площадь") | ★★★★☆ | ★★★☆☆ |
| Смешанный EN/RU | ★★☆☆☆ — теряет согласование | ★☆☆☆☆ |
| Чистый русский | ★☆☆☆☆ — рандомный результат | ★☆☆☆☆ |

**Правило:** `visualPrompt` — строго English (Latin-only кроме имён брендов). `descriptionRu` — отдельное поле, только для UI и TTS.
**Валидатор:** regex `/[а-яё]/i` в `visualPrompt` = reject.

### 3.4 Описания тела/кожи × NSFW фильтр Atlas

Atlas Seedance 2.0 использует строгий content filter. Триггерные паттерны (подтверждены в production):

| Слово/фраза | Результат | Замена |
|---|---|---|
| `naked`, `nude`, `nudity` | hard block | `elegant`, `refined silhouette` |
| `sexy`, `sensual` | soft block | `graceful`, `confident` |
| `tight athletic wear`, `form-fitting` | soft block | `sport apparel`, `performance wear` |
| `bare skin`, `exposed shoulders` | soft block | `warm skin tone`, `natural complexion` |
| `lingerie`, `underwear` | hard block | `silk fabric`, `delicate textile` |
| `bloody`, `violent`, `weapon` | hard block | `dramatic`, `bold` |
| `drug`, `pills`, `addiction` | hard block | `capsule`, `wellness product` |
| `death`, `dying`, `kill` | hard block | `fading`, `dissolving` |
| `child`, `kid` + суггестивный контекст | hard block | `young adult` (18+) |

**Фикс:** `sanitizePromptForNSFW` работает постфактум — это правильно как safety net, но **хорошая генерация не должна этого требовать**. В SYSTEM_PROMPT нужен явный список "never-use words" для каждой ниши.

Дополнительно: для ниш cosmetics/fitness/fashion нужно **preemptive list** разрешённых анатомических слов: `cheekbone`, `collarbone`, `silhouette`, `profile`, `hand`, `palm`, `eyelash` — это безопасно.

### 3.5 Количество `@Image` тегов в одном промте × поведение Seedance

| Тегов в одной сцене | Seedance 2.0 ведёт себя |
|---|---|
| 0 | Рендерит по тексту (hero image через `image_url`) |
| 1 | ★★★★★ — идеал, один субъект |
| 2 | ★★★★☆ — композиция двух ассетов, возможен лёгкий морф |
| 3 | ★★★☆☆ — начинает путать, один из ассетов может не попасть |
| 4+ | ★★☆☆☆ — каша, accurate rendering не гарантировано |

**Правило:** **не более 2 `@Image` тегов на сцену.** Исключение: последняя сцена (логотип + продукт = 2 тега OK).

### 3.6 Длина промта в словах × качество

| Слов в `visualPrompt` | Seedance 2.0 поведение |
|---|---|
| <40 | Undertrained — модель додумывает → рандом |
| 40–60 | Недостаточно спецификации |
| **60–100** | **Sweet spot — идеальная зона** |
| 100–130 | OK, но модель начинает игнорировать последние токены |
| 130–200 | Первые 80 слов используются, остальные фактически игнорируются |
| >200 | Деградация качества, возможен reject промта Atlas-ом |

**Правило:** `60 ≤ wordCount ≤ 100`. Сейчас `guardScript` режет на 130 — это **слишком поздно и слишком много**.

### 3.7 Описания людей, эмоций, движений × Seedance

| Что писать | Как Seedance интерпретирует |
|---|---|
| "woman walks" | Generic походка → скучно |
| "woman walks slowly toward camera, confident stride, gaze locked forward" | Точное исполнение |
| "she feels happy" | Не работает — Seedance не видит эмоций |
| "slight smile begins at left corner of mouth, eyes softly crinkle" | Работает — конкретная механика |
| "fast running" | Motion blur, артефакты |
| "steady jog at moderate pace, feet touching ground rhythmically" | Чисто |
| "jumping, leaping, twirling" | Физика ломается на длинных кадрах |
| "single arm raise over 3 seconds" | Чисто |

**Правило для людей:** ОДНО действие, конкретная механика, **без перечислений**. "She turns, looks, then smiles" → хотя бы 3 попытки Seedance → три разных результата склеенных → некогерентно.

### 3.8 Тип сцены (sceneType) × переходы в FFmpeg

| sceneType → sceneType | Лучший transition | Запрещённые |
|---|---|---|
| nature → product | `fade`, `fadeblack` (2 сек) | `pixelize`, `hblur` |
| product → face | `dissolve`, `radial` (0.8 сек) | `wipeleft` (резко) |
| face → action | `distance`, `zoomin` (0.5 сек) | `fade` (слишком спокойно) |
| action → action | `slideleft`, `circleopen` (0.4 сек) | `fadeblack` (убивает ритм) |
| product → logo | `fadeblack` (1 сек) | любые wipe |
| logo → END | `fadeblack` out | — |
| action → logo | `circleclose` + `fadeblack` | slide (диссонанс) |

**Правило:** LLM возвращает `sceneType`, pipeline выбирает transition по матрице, **не доверяя LLM выбирать transition** (он всё равно напишет "cool transition").

### 3.9 Список FFmpeg `xfade` transitions × реальная доступность

Текущий `probeFFmpegTransitions` проверяет что реально работает на production FFmpeg. Исторически проблемные:

| Transition | Статус | Комментарий |
|---|---|---|
| `fade` | ✅ ВСЕГДА | Safe default |
| `fadeblack`, `fadewhite` | ✅ | Safe |
| `dissolve` | ✅ | Safe |
| `distance` | ✅ | Safe |
| `wipeleft`, `wiperight`, `wipeup`, `wipedown` | ✅ | Safe |
| `slideleft`, `slideright`, `slideup`, `slidedown` | ✅ | Safe |
| `circleopen`, `circleclose` | ⚠️ | Работает только в 4.4+ |
| `radial` | ⚠️ | 4.4+ |
| `zoomin` | ⚠️ | 5.0+ |
| `hblur`, `vblur` | ❌ CRASH | Известный segfault на некоторых сборках |
| `pixelize` | ❌ CRASH | Падает на вертикальном видео |
| `vibrance` (filter) | ❌ CRASH | Известно из deep_audit_v2.md |
| `horzopen`, `vertopen` | ⚠️ | Часто черный flash |

**Правило:** LLM **никогда не пишет transition в сценарии**. Pipeline подбирает через `probeFFmpegTransitions().verified` ∩ матрица совместимости из 3.8.

### 3.10 Цветокоррекция (mood) × типичные ожидания ниш

| Mood | LUT/filter | Ниши, где работает | Где НЕ работает |
|---|---|---|---|
| Люкс | `curves=dark_amber` + vignette | cosmetics, fashion, perfume, real_estate | fitness, tech |
| Энергия | `eq=saturation=1.3:contrast=1.2` | fitness, music, sport, fashion | luxury perfume |
| Мягко | `eq=brightness=0.05:saturation=0.9` | cosmetics, food, family | music, tech |
| Дерзко | high-contrast B&W или neon | music, streetwear, fashion | food, real_estate |
| Минимализм | `eq=saturation=0.7` | tech, real_estate, minimalist fashion | music, food |
| Игриво | `eq=saturation=1.4`, bright | toys, food, family | luxury, real_estate |

**Правило:** mood выбирается пользователем, pipeline применяет LUT глобально — **LLM не трогает цветокор**.

### 3.11 TTS voiceover × длина сцен × синхронизация

Правило синхронизации voiceover:
- Средняя скорость: **2.5 слова русского текста в секунду** (ElevenLabs), **2.8 слова английского** в секунду.
- 5 сек сцена = 12 слов RU max (включая паузы — реально 10).
- 10 сек сцена = 25 слов RU max.
- 15 сек сцена = 37 слов RU max.

| Длина `descriptionRu` | 5 сек сцена | 10 сек сцена | 15 сек сцена |
|---|---|---|---|
| 10 слов | ✅ | ✅ | ✅ с паузами |
| 20 слов | ❌ обрежется | ✅ | ✅ |
| 30 слов | ❌ | ⚠️ tight | ✅ |
| 40+ слов | ❌ | ❌ | ❌ |

**Правило:** Валидатор проверяет `descriptionRu.split(/\s+/).length ≤ duration × 2.5`.

### 3.12 Музыка × BPM × длина ролика

| Mood | Целевой BPM | Длина одного музыкального "такта" (4 beats) | Рекомендация |
|---|---|---|---|
| Люкс | 60–75 | ~3.2 сек | Сцены 5 или 10 сек — ложатся на такт |
| Энергия | 120–140 | ~1.8 сек | Сцены 5 сек OK |
| Мягко | 70–90 | ~2.7 сек | Сцены 5 или 10 сек |
| Дерзко | 90–110 | ~2.2 сек | Сцены 5 сек |
| Минимализм | 60–80 | ~3 сек | Сцены 8 или 10 сек |
| Игриво | 100–130 | ~2 сек | Сцены 5 сек |

**Правило:** если пользователь не загружает свою музыку — генерация через Suno/Mubert с **точным BPM** и **длина ролика, кратная такту**.

### 3.13 Fast cuts (<2 сек) × FFmpeg

FFmpeg xfade требует `offset ≥ transitionDuration`. Если сцена 2 сек и transition 0.5 сек — работает. Если сцена <1.5 сек — FFmpeg бракует. Seedance **не умеет генерировать <5 сек**. Поэтому **fast cuts невозможны на уровне модели**. Если нужен fast cut эффект — его делает post-processing: **нарезка 10-сек клипа на 2-секундные фрагменты внутри FFmpeg**.

**Правило:** сцены всегда ≥5 сек. Fast-cut эффект — только через `-ss` / `-t` нарезку в ассамблере, НЕ через сценарий.

---

## 4. Что НЕЛЬЗЯ (Anti-patterns)

Конкретные примеры того что ломает пайплайн. **Каждый из этих примеров видел в логах.**

### 4.1 NSFW-ловушки
```
❌ "A woman in tight athletic wear showing her toned skin, close-up of her midriff"
→ Atlas: "Content policy violation"
→ Fallback на fal.ai (хуже + дороже)

✅ "A woman in sport apparel, confident pose, medium shot focused on shoulders and posture, warm studio light"
```

### 4.2 Duration mismatch
```
❌ duration: "15 sec" + useAtlas: false (fal.ai)
→ fal.ai молча возвращает 10 сек, рассинхрон аудио

❌ duration: "7 sec"
→ Atlas округляет вверх к 8, рассинхрон музыкального такта

✅ duration: "5" | "8" | "10" | "15" (строгий enum)
```

### 4.3 Orphaned @Image tags
```
❌ Пользователь загрузил 2 фото. Промт: "@Image1 stands next to @Image6 partner brand sign"
→ @Image6 нет → Seedance вставляет рандомный sign → brand damage

✅ Pipeline знает что загружено [1,2,4]. LLM получает whitelist. Использует только эти.
```

### 4.4 Смешанный язык
```
❌ visualPrompt: "Красивая женщина walks through Moscow street, cinematic lighting, атмосфера ночного города"
→ Seedance разваливается, кадр генерится в аниме-стиле (известный баг)

✅ visualPrompt: "Woman in elegant coat walks through night Moscow street, neon signs reflect on wet pavement, cinematic blue-orange grade"
```

### 4.5 Слишком длинные промты
```
❌ 220-словный промт с 5 предложениями, 3 разными действиями, 4 типами освещения, 2 камерными движениями
→ Seedance использует первые 80 слов, остальное теряется
→ guardScript режет постфактум → содержание ампутировано

✅ 75 слов: один субъект, одно действие, одно освещение, одно движение камеры
```

### 4.6 Запрещённые FFmpeg transitions
```
❌ LLM: "transition to next scene: hblur fade"
→ FFmpeg crash

❌ LLM: "use pixelize transition for retro feel"
→ Segfault на вертикале

✅ LLM вообще не пишет transitions. Матрица 3.8 решает.
```

### 4.7 Fast cuts в сценарии
```
❌ LLM: 10 сцен по 1.5 сек каждая для "energetic feel"
→ Seedance не умеет генерить <5 сек → каждая сцена по 5 сек → ролик 50 сек вместо 15
→ Или все clipпы обрезаются до 1.5 сек → $$$$ потрачены на 3.5 сек, которые выкинули

✅ 3 сцены по 5 сек, а fast-cut эффект создаётся нарезкой в FFmpeg пост-процессе
```

### 4.8 Мульти-действие в одной сцене
```
❌ "She walks to the table, picks up the bottle, turns to camera, smiles, then raises it"
→ Seedance видит 5 действий → выполнит 1–2, остальные игнор → некогерентно

✅ "She raises the perfume bottle slowly to eye level, calm confident expression" (ОДНО действие)
```

### 4.9 Vague lighting
```
❌ "beautiful cinematic lighting"
→ Seedance → flat gray default

✅ "warm amber rim light from back-left, soft fill from right at 30% intensity, deep shadows on the product"
```

### 4.10 Несогласованные color temperature между сценами
```
❌ Scene 1: "cool blue moonlit desert"
   Scene 2: "warm golden sunlit beach"
→ FFmpeg fade/dissolve покажет жёсткий color jump → любительский результат

✅ Scene 1: "cool amber twilight desert"
   Scene 2: "warm amber golden hour beach"
→ Temperature continuity → плавный переход
```

### 4.11 Логотип до Scene N-1
```
❌ LLM генерирует логотип уже в Scene 2 ("brand reveal early")
→ Пользователь видит бренд до эмоционального пика → impact теряется
→ В последней сцене LLM не знает что ещё показать

✅ Логотип появляется ТОЛЬКО в последней сцене. Scene N-1 может намекать (монограмма, цвет).
```

### 4.12 Эмоции без механики
```
❌ "She feels nostalgic looking at the photo"
→ Seedance не видит "nostalgia"

✅ "Her eyes soften, a small pause before blinking, head tilts 5 degrees"
```

---

## 5. Оптимальная архитектура генерации сценария

### 5.1 Подход: почему Hybrid Template + LLM

**Вариант A — Чистый LLM (текущий):**
- LLM сам решает структуру, длину, transitions, @Image placement.
- Плюс: гибкость.
- Минус: непредсказуем, 30% генераций ломают pipeline.

**Вариант B — Чистый Template:**
- Мы заранее пишем 20 шаблонов, LLM только подставляет слова.
- Плюс: 100% compatibility.
- Минус: скучно, нет персонализации под бренд/mood/референс.

**Вариант C — Hybrid (предлагаемый):**
1. **Template layer** — pipeline детерминированно решает СТРУКТУРУ: сколько сцен, какой длительности, какой `sceneType` на каждой позиции, какой transition между ними.
2. **LLM layer** — LLM получает этот скелет как **constraint** и ТОЛЬКО генерирует **визуальный контент** (description + visualPrompt) для каждой сцены.
3. **Enrichment layer** — второй LLM-проход видит изображения (Gemini Vision) и уточняет промт под реальный контент фотографий.
4. **Validation layer** — Zod + regex + LLM-judge проверяют совместимость.
5. **Repair layer** — `guardScript` как last resort, но должен срабатывать редко.

**Почему это работает:**
- Детерминизм на уровне структуры → pipeline всегда предсказуем.
- Креатив на уровне контента → ролики не повторяются.
- LLM не решает технические вопросы, которых не понимает (длина, transitions, NSFW-риск).
- Второй проход с vision закрывает слепое пятно "LLM не знает что на фото".

### 5.2 Стек моделей для скрипта

| Этап | Модель | Почему | Стоимость |
|---|---|---|---|
| **1. Structure planner** | Детерминированный TS (без LLM) | Нулевой риск галлюцинаций | $0 |
| **2. Draft generation** | Groq LLaMA 3.3 70b | Быстро (1–2 сек), качество достаточно для черновика | ~$0.001/скрипт |
| **3. Vision enrichment** | Gemini 2.0 Flash (multimodal) | Видит загруженные фото, уточняет `@Image` промты | ~$0.002/скрипт |
| **4. Quality gate (judge)** | Groq LLaMA 3.3 70b (другой запрос) | Cross-provider sanity check, оценивает compatibility | ~$0.001 |
| **5. Escalation** | Claude Sonnet 4.6 через OpenRouter | Только если judge score <75 | ~$0.02 |
| **6. Repair** | `guardScript` (TS, без LLM) | Safety net | $0 |

**Средняя стоимость одного скрипта: ~$0.005**. Escalation срабатывает в ~10% случаев → среднее $0.007.

### 5.3 Структура идеального сценария

```json
{
  "sceneNumber": 1,
  "duration": "5",
  "sceneType": "nature",
  "emotion": "anticipation",
  "visualPrompt": "Vast desert at blue hour, single figure in ivory silk stands on the highest dune facing away from camera, warm amber rim light traces the silhouette from the horizon. Slow push-in from 20 meters to 8 meters. Loose fabric drifts in the wind to the right. Editorial luxury cinematography, amber and deep indigo palette, sharp silhouette against soft gradient sky. Avoid lens flare, avoid motion blur on figure.",
  "cameraMovement": "slow push-in",
  "transitionTo": "dissolve",
  "descriptionRu": "Пустыня на синем часе. Фигура в шёлке стоит на вершине дюны. Ветер уносит край ткани.",
  "imagePrimarySlot": 1,
  "nsfwRisk": "low",
  "exitDirection": "figure-right",
  "entryContinuity": "silhouette-center"
}
```

**Объяснение каждого поля:**

| Поле | Тип | Откуда берётся | Назначение |
|---|---|---|---|
| `sceneNumber` | `int` | Planner | Позиция в нарративной арке |
| `duration` | `enum("5","8","10","15")` | Planner | Строгий enum, совместим с Atlas |
| `sceneType` | `enum("nature","product","face","action","logo")` | Planner | Определяет transition к следующей сцене |
| `emotion` | `enum` (15 значений) | LLM | Ведёт нарратив, используется в промте (не напрямую) |
| `visualPrompt` | `string` EN, 60–100 слов | LLM | Отправляется в Seedance |
| `cameraMovement` | `enum` (7 значений) | LLM выбирает из whitelist | Один из 7 разрешённых |
| `transitionTo` | `enum` FFmpeg transitions | Planner (не LLM!) | Рассчитывается из sceneType → sceneType |
| `descriptionRu` | `string` RU | LLM, ограничен `duration*2.5` слов | Для UI и TTS |
| `imagePrimarySlot` | `int ∈ [1..6] \| null` | LLM | Главный `@Image` в этой сцене (для вес. композиции) |
| `nsfwRisk` | `enum("low","medium","high")` | LLM self-assess | Флаг для pre-sanitize |
| `exitDirection` | `enum("left","right","up","down","center","zoom-in","zoom-out")` | LLM | Для match cuts |
| `entryContinuity` | `string` короткий | LLM | Элемент, который продолжается из предыдущей сцены |

**Почему именно так:**
- `duration` как строка с enum — защита от `parseInt` ошибок и от нечисловых значений.
- `sceneType` — единственный "классификатор", по которому выбирается transition: убирает LLM из цепочки принятия технических решений.
- `emotion` — не для Seedance, а для **LLM-судьи** проверять emotional arc (scene 1 ≠ scene N по эмоции).
- `imagePrimarySlot` — даёт pipeline возможность выбрать правильный `image_url` для Atlas (главный frame сцены).
- `nsfwRisk` — LLM сам себя оценивает, если поставил "high" — pipeline принудительно прогоняет через расширенный sanitizer.
- `exitDirection`/`entryContinuity` — пара полей для match cut continuity, валидатор проверяет соответствие.

### 5.4 Промт-инжиниринг для визуальных промтов

**Формула идеального `visualPrompt`:**

```
[Subject + Setting] .
[Single Action, present tense] .
[Camera Movement: ONE from whitelist] .
[Lighting: type + direction + quality] .
[Style + Color grade + Niche keyword] .
[Avoid: 2-3 specific artifacts] .
```

**Длина:** 60–100 слов (65–75 — sweet spot).

**Язык:** ВСЕГДА English. Исключения — имена брендов и топонимы (`Moscow`, `Chanel`).

**Порядок `@Image` тегов:** первый в промте = главный субъект сцены = совпадает с `imagePrimarySlot`.

**Anti-correction patterns** (фразы, которые повышают compliance Seedance):
- ✅ `"apply directly"` — не `"try to apply"`
- ✅ `"render exactly"` — не `"aim to render"`
- ✅ `"the [X]"` (определённый артикль) — модель точнее интерпретирует
- ✅ `"single [feature]"` — исключает "полутона"
- ❌ `"maybe"`, `"perhaps"`, `"possibly"`
- ❌ `"it should look like..."` — модель ищет "should" в тренировочной выборке, получает школьные туториалы

**Пример идеального визуального промта (cosmetics, 5 сек):**
```
@Image2 amber serum bottle stands on cracked black marble surface at night.
Single slow 180° orbit around the bottle at constant distance.
Warm amber rim light from upper-left at 45°, deep shadows on right side, faint glow on bottle cap.
Luxury editorial beauty commercial, Chanel-style cinematography, ambers and deep blacks only.
Avoid overexposed highlights. Avoid motion blur on the bottle.
```
(72 слова, один субъект, одно движение камеры, одно освещение, один стиль, два "avoid".)

### 5.5 Нишевые Visual Style Guides

Каждая ниша = контракт из 4 элементов: **запрещённые слова**, **обязательные слова**, **структура**, **пример**.

---

#### 5.5.1 COSMETICS / SKINCARE / PERFUME

**Запрещено (NSFW риск):** `bare skin`, `naked`, `intimate`, `seductive`, `licking`, `touching lips`, `undressed`.

**Обязательно:** `luxury`, `editorial`, `commercial`, `natural complexion`, `soft glow`, `texture detail`.

**Палитра (если бренд не задал):** `warm amber`, `ivory`, `rose gold`, `deep black`, `champagne`.

**Структура:**
```
[Product/model] on [luxury surface] .
[Single cinematic action: pour | reveal | bottle rotate | hand lift] .
[Slow camera movement] .
[Warm/soft lighting from direction] .
[Luxury editorial beauty commercial, specific color palette] .
Avoid overexposure, avoid flat lighting.
```

**Пример:**
```
@Image1 close-up portrait of a woman's profile at golden hour, warm skin tone, a single drop of @Image2 serum rests on her collarbone. Slow rack focus from the drop to her eyelash. Warm amber backlight from the right at 30°, soft fill from front-left, deep shadows behind. Luxury editorial beauty commercial, Dior Beauty aesthetic, amber and ivory palette, natural complexion. Avoid overexposed highlights, avoid flat lighting.
```

---

#### 5.5.2 FASHION / CLOTHING

**Запрещено:** `tight`, `form-fitting`, `revealing`, `cleavage`, `skinny`, `sexy`.

**Обязательно:** `editorial`, `runway`, `silhouette`, `architectural`, `drape`, `tailored`.

**Палитра:** обычно монохром + 1 акцент от бренда.

**Структура:**
```
[Model in outfit] in [architectural/minimalist space] .
[Single motion: walk | turn | fabric shift] .
[Tracking shot | static hold | slow orbit] .
[Stark contrast lighting from one source] .
[Editorial fashion, Saint Laurent/Balenciaga/Zara aesthetic, palette] .
Avoid jitter, avoid flat fabric.
```

**Пример:**
```
@Image1 model in charcoal tailored coat walks through an empty marble corridor. Medium tracking shot from the side at 4 meters. Harsh side light from tall windows on the left, deep shadows on the right wall, fabric drapes catch the light with each step. Editorial fashion cinematography, Saint Laurent runway aesthetic, charcoal and ivory palette, architectural framing. Avoid subject jitter, avoid flat fabric drape.
```

---

#### 5.5.3 LUXURY (perfume, jewelry, watches, automotive)

**Запрещено:** `cheap`, `colorful`, `bright` (без уточнения), `cute`, `playful`.

**Обязательно:** `editorial`, `cinematic`, `slow`, `reveal`, `depth`, `rich shadows`.

**Палитра:** `deep black`, `gold`, `ivory`, `rich burgundy`, `anthracite`.

**Структура:**
```
[Luxury object] on [luxury surface] in [atmospheric setting] .
[Ultra-slow single motion: orbit | push-in | tilt] .
[One-source dramatic lighting, specific direction + angle] .
[Luxury commercial, specific brand reference, rich palette] .
Avoid flat lighting, avoid bright fills, avoid motion blur.
```

**Пример:**
```
@Image2 gold watch rests on black obsidian under single spotlight. Ultra-slow 30-degree orbit around the watch face, camera height at watch level. Warm gold key light from upper-right at 60°, zero fill, deep void shadows on the left side, faint reflection of gold in the obsidian surface. Luxury commercial cinematography, Cartier editorial style, gold and deep black palette only. Avoid flat lighting, avoid bright fills, avoid motion blur on the watch.
```

---

#### 5.5.4 FOOD & DRINK

**Запрещено:** `plain`, `simple`, `dry`, `bland`, `ordinary`.

**Обязательно:** `macro`, `texture`, `steam`, `condensation`, `appetizing`, `rich`.

**Палитра:** `warm brown`, `rich cream`, `deep red` (для напитков), `golden`.

**Структура:**
```
[Food item] on [wooden/marble/ceramic surface] .
[Single sensory moment: pour | melt | steam rises | bite | slice] .
[Slow macro push-in OR overhead hold] .
[Warm natural window light from direction] .
[Food commercial, Magnum/Lavazza style, warm palette] .
Avoid harsh shadows, avoid unappetizing color shifts.
```

**Пример:**
```
Single @Image2 chocolate truffle sits on rustic dark wood board. Steam slowly rises from a warm cup beside it while condensation drips down the glass. Slow macro push-in from 20cm to 5cm toward the truffle surface. Warm natural window light from the left at 45°, soft amber fill from the right. Food commercial cinematography, Magnum chocolate aesthetic, warm brown and cream palette, rich textured shadows. Avoid harsh shadows on the truffle, avoid cold color shifts.
```

---

#### 5.5.5 FITNESS / SPORT / ATHLETIC

**ОСОБО запрещено (высокий NSFW риск):** `tight`, `form-fitting`, `skin`, `sweaty`, `revealing`, `midriff`, `toned body`, `muscular definition`.

**Обязательно:** `sport apparel`, `performance wear`, `confident posture`, `athletic stance`, `determined`.

**Палитра:** `bold primary` + `neutral`, часто `neon` акценты.

**Структура:**
```
[Athlete in sport apparel] in [arena/gym/urban] .
[Single dynamic motion: stride | stance | controlled jump] .
[Tracking shot OR slow orbit] .
[Dramatic side light] .
[Sport commercial, Nike/Adidas editorial aesthetic, bold palette] .
Avoid fast motion blur, avoid skin focus.
```

**Пример:**
```
@Image1 athlete in red sport apparel stands in confident stance on indoor track, medium shot from 3 meters. Slow 20° orbit around the athlete at constant distance. Harsh dramatic side light from the left, cool fill from the right, deep shadows behind. Sport commercial cinematography, Nike Training editorial aesthetic, red and charcoal palette. Avoid fast motion blur, avoid skin focus, avoid camera shake.
```

---

#### 5.5.6 TECH / GADGETS

**Запрещено:** `organic`, `warm`, `soft` (без уточнения), `vintage`.

**Обязательно:** `precision`, `engineering`, `clean`, `minimal`, `matte`, `detail`.

**Палитра:** `pure white`, `anthracite`, `silver`, `one brand accent color`.

**Структура:**
```
[Device] on [clean surface] against [neutral backdrop] .
[Single mechanical motion: rotate | reveal | hover] .
[Slow macro push-in OR static top-down] .
[Clean studio lighting, 3-point setup] .
[Tech commercial, Apple/Nothing style, clean palette] .
Avoid clutter, avoid warm tones.
```

**Пример:**
```
@Image2 smartphone hovers 10cm above a pure white seamless surface against a clean anthracite backdrop. Slow 360° rotation of the device around its vertical axis. Clean three-point studio lighting: key at 45° upper-left, fill at 30% right, rim from behind for edge highlight. Tech commercial cinematography, Apple product launch aesthetic, white and anthracite palette, precision focus. Avoid clutter, avoid warm tones, avoid reflections on the surface.
```

---

#### 5.5.7 REAL ESTATE

**Запрещено:** `cluttered`, `cramped`, `dark`, `old` (неуточнённое).

**Обязательно:** `spacious`, `light-filled`, `architectural`, `view`, `lifestyle`, `aspirational`.

**Палитра:** `natural light warm neutrals`, `beige`, `sand`, `gold accent`.

**Структура:**
```
[Interior/exterior] of [specific property type] at [time of day] .
[Slow camera reveal: dolly | overhead | pan] .
[Natural sunlight OR golden hour] .
[Architectural lifestyle commercial, Sotheby's/AD style, palette] .
Avoid harsh shadows, avoid clutter.
```

**Пример:**
```
Empty living room of a modern penthouse at golden hour, floor-to-ceiling windows reveal a city skyline. Slow dolly-back from the window toward the room center over 8 seconds. Warm natural sunlight streams from the left at 45°, soft ambient fill from ceiling reflection, long shadows stretch across the marble floor. Architectural real estate commercial, Sotheby's luxury property aesthetic, warm neutral palette. Avoid harsh window flare, avoid clutter on surfaces.
```

---

#### 5.5.8 SUPPLEMENTS / WELLNESS

**ОСОБО запрещено (medical NSFW риск):** `drug`, `pill` (без уточнения), `prescription`, `cure`, `disease`, `addiction`, `sick`, `patient`, `pain`.

**Обязательно:** `wellness`, `capsule`, `supplement`, `natural`, `botanical`, `daily ritual`, `holistic`.

**Палитра:** `soft green`, `warm cream`, `earth tones`, `sage`.

**Структура:**
```
[Supplement bottle/capsule] in [natural ingredient setting] .
[Single calm motion: pour | reveal | botanical shift] .
[Slow overhead or macro push-in] .
[Soft natural light] .
[Wellness commercial, botanical editorial style, earth palette] .
Avoid clinical look, avoid medical imagery.
```

**Пример:**
```
@Image2 wellness supplement bottle stands on a smooth river stone surrounded by fresh sage leaves and chamomile flowers. Slow overhead camera tilts down from above to the bottle label at 45°. Soft natural morning light from the left through diffused window, gentle shadows, warm amber undertone. Wellness commercial cinematography, botanical editorial aesthetic, sage and cream palette. Avoid clinical look, avoid medical imagery, avoid harsh shadows.
```

---

## 6. Pipeline Validation (что нужно проверить ДО отправки)

Новый валидатор `validateScriptCompatibility(script, context)` запускается **после** парсинга и **до** возврата клиенту. Возвращает массив `{scene, field, error}`. Если массив непустой — LLM перегенерирует только проблемные сцены (`retryScene(i, reason)`).

### 6.1 Чеклист

```typescript
interface CompatibilityCheck {
  // ─── Language ──────────────────────────────────────────────
  allPromptsEnglish: boolean;           // regex /[а-яё]/i === null
  
  // ─── Length ────────────────────────────────────────────────
  allPromptsInWordRange: boolean;       // 60 ≤ words ≤ 100
  allDescriptionsRuFitTTS: boolean;     // words ≤ duration * 2.5
  
  // ─── @Image ────────────────────────────────────────────────
  allImageTagsWhitelisted: boolean;     // все @ImageN ∈ availableSlots
  maxTwoImagesPerScene: boolean;        // не более 2 тегов на сцену
  primarySlotMatchesFirst: boolean;     // imagePrimarySlot === первый @Image в промте
  
  // ─── Duration ──────────────────────────────────────────────
  allDurationsEnum: boolean;            // строго "5"|"8"|"10"|"15"
  durationCompatibleWithModel: boolean; // если fal.ai — не "8", не "15"
  
  // ─── NSFW ──────────────────────────────────────────────────
  noNSFWTriggers: boolean;              // нишевой blacklist
  noNSFWByRisk: boolean;                // если nsfwRisk="high" — extended sanitizer
  
  // ─── Structure ─────────────────────────────────────────────
  lastSceneHasLogo: boolean;            // @Image4 или описание логотипа в последней сцене
  firstSceneNoProduct: boolean;         // в Scene 1 НЕТ @Image2 (hook rule)
  totalDurationMatchesFormat: boolean;  // сумма === выбранный videoDuration
  
  // ─── Camera ────────────────────────────────────────────────
  allCameraMovementsInWhitelist: boolean; // enum из 7 значений
  oneMovementPerScene: boolean;           // нет "zoom and pan"
  
  // ─── Continuity ────────────────────────────────────────────
  exitEntryChainValid: boolean;         // scene[i].exitDirection ↔ scene[i+1].entryContinuity
  colorTemperatureContinuity: boolean;  // нет резких warm↔cool jumps
  
  // ─── Scene types ───────────────────────────────────────────
  sceneTypeTransitionValid: boolean;    // по матрице 3.8
  
  // ─── Emotional arc ─────────────────────────────────────────
  emotionArcPresent: boolean;           // не все сцены одной эмоции
  emotionPeakBeforeEnd: boolean;        // пик в scene N-1 или N, не scene 1
}
```

### 6.2 Алгоритм перегенерации

```
1. Запустить validateScriptCompatibility → получить issues[]
2. Если issues.length === 0 → return script
3. Если issues.length ≤ 3 И все относятся к ≤2 сценам → retryScene(sceneIdx, issues)
   (точечный ретрай: LLM получает ТОЛЬКО ту сцену и список проблем)
4. Если issues.length > 3 ИЛИ структурные проблемы → full regenerate с добавлением issues в user message
5. Лимит: 2 retry total. После → fallback на guardScript repair + warning в _meta
```

---

## 7. Рекомендуемые внешние инструменты

### 7.1 Уже интегрировано в проект
- `GEMINI_API_KEY` — есть, используется для `analyze` задач
- `GROQ_API_KEY` — есть, primary для script
- `OPENROUTER_API_KEY` — есть, Claude Sonnet для эскалации
- `ATLAS_CLOUD_API_KEY` — есть, Seedance 2.0
- `FAL_API_KEY` — есть, fallback
- FFmpeg с `probeFFmpegTransitions` — есть

### 7.2 Надо добавить для улучшения сценариев

| Инструмент | Зачем | Приоритет | Стоимость |
|---|---|---|---|
| **Suno API** (v4) | Автоматическая музыка под точный BPM по mood. Текущий buildSunoPrompt в StepVideo.tsx уже готов, но интеграция не сделана | HIGH | ~$0.08/трек |
| **ElevenLabs v2** | TTS voiceover с брендовым голосом (voice cloning из одной записи) | HIGH | ~$0.15/минута |
| **Mubert API** | Royalty-free музыка с точным контролем длины и BPM (альтернатива Suno для коммерческого использования) | MED | ~$0.05/трек |
| **Gemini 2.0 Flash Vision** (уже есть ключ, но не используется для enrichment скрипта) | Vision-enrichment: LLM видит реальное фото, уточняет promt (например "hero wears red jacket" → учитывается в сцене) | **HIGH** | ~$0.002/скрипт |
| **Replicate Flux Pro** | Если нужен hero frame до видео (current: HF Flux Schnell бесплатный, но лимит) | LOW | ~$0.055/image |
| **AssemblyAI** | Транскрипция пользовательских видео-референсов (текущий референс анализируется только визуально) | LOW | ~$0.01/минута |

### 7.3 Что не надо добавлять
- ❌ Ещё один text LLM (у нас уже Groq + Gemini + Claude — хватает)
- ❌ Отдельный prompt-refine сервис — мы сами контролируем prompt engineering
- ❌ Stability AI video — хуже Seedance по всем метрикам

---

## 8. Метрики качества сценария

Quality gate должен **числово** оценивать скрипт, а не просто "good/bad". Если score <75 → эскалация на Claude Sonnet.

### 8.1 Формула score

```
score = 0.20 * brandCoverage
      + 0.15 * imageCoverage
      + 0.20 * emotionalArcScore
      + 0.15 * durationBalance
      + 0.15 * compatibilityScore
      + 0.10 * specificityScore
      + 0.05 * nsfwSafetyScore

Passing threshold: 75
Excellence threshold: 90
```

### 8.2 Метрики детально

#### 8.2.1 Brand Coverage (0–100)
```
brandCoverage = (scenesWithBrandRef / totalScenes) * 100
```
- Сцена содержит бренд-референс если: упомянут `@Image2..6`, или brandName в описании, или brand color явно в lighting.
- Требование: ≥70% сцен должны иметь бренд-touch.

#### 8.2.2 Image Coverage (0–100)
```
imageCoverage = (usedSlots.size / availableSlots.size) * 100
```
- Все загруженные assets должны использоваться хотя бы в одной сцене.
- Если пользователь загрузил 4 фото но использовано 2 — score 50 (недоиспользован контент).

#### 8.2.3 Emotional Arc Score (0–100)

```
emotionArc = [emotion_scene_1, emotion_scene_2, ..., emotion_scene_N]
```

Проверяется:
1. **Variety**: уникальных эмоций ≥ 3 → +40
2. **Peak position**: пик эмоции в scene N-1 или N → +30
3. **Build**: интенсивность монотонно растёт или растёт до пика → +30

Пример идеального arc для 5 сцен:
```
[calm (3) → anticipation (5) → desire (7) → reveal (9) → pride (10)]
```

Пример плохого:
```
[excited (9) → excited (9) → excited (9) → excited (9) → excited (9)]
```
(Монотонно, peak в scene 1, нет variety → score ~15.)

#### 8.2.4 Duration Balance (0–100)

```
durationBalance = 100 - variance_penalty
```

- Если все сцены одной длины → penalty = 50 (монотонно)
- Если одна сцена занимает >60% общего времени → penalty = 30
- Если ритм осмысленный (длинные сцены — установочные, короткие — action) → bonus +20
- Идеал: смешанный ритм, длины подобраны под sceneType.

#### 8.2.5 Compatibility Score (0–100)

Количество нарушений checklist из раздела 6.1:
```
compatibilityScore = 100 - (violationCount * 10)
```
Требование: ≥85 (т.е. ≤1 нарушение).

#### 8.2.6 Specificity Score (0–100)

Проверка на "generic" слова. Штраф за каждое употребление без уточнения:
- `beautiful`, `cinematic`, `amazing`, `stunning`, `epic`, `perfect`, `great`, `nice` — −5 за штуку
- Уточнённое употребление (`cinematic ambers`, `beautiful amber hue`) — не штрафуется.

#### 8.2.7 NSFW Safety Score (0–100)

```
nsfwSafetyScore = 100 - (highRiskWords * 20) - (mediumRiskWords * 5)
```

Требование: ≥90. Меньше → форс-ран `sanitizePromptForNSFW` + повторная проверка.

### 8.3 Judge prompt (Groq LLaMA 70b)

```
You are a strict QA judge for AI video scripts targeting Seedance 2.0.

For the script below, compute the following numeric scores (0-100 each):
- brandCoverage
- imageCoverage  
- emotionalArcScore
- durationBalance
- compatibilityScore
- specificityScore
- nsfwSafetyScore

Also list specific issues as: {"scene": N, "field": "...", "problem": "..."}.

Return ONLY JSON:
{
  "scores": {...},
  "totalScore": weighted_sum,
  "issues": [...],
  "verdict": "pass" | "retry" | "escalate"
}

verdict rules:
- pass if totalScore >= 75 AND compatibilityScore >= 85
- retry if 60 <= totalScore < 75
- escalate if totalScore < 60 OR compatibilityScore < 60
```

### 8.4 Логирование для аналитики

Каждый генерируемый скрипт логируется в базу с полями:
```
{
  timestamp, user_id, niche, mood, platform, duration_format,
  scores: {...},
  attempts, escalated,
  repairs_applied, warnings,
  final_model (groq | claude-sonnet | gemini),
  generation_time_ms
}
```

Через 2 недели работы анализ:
- Какие ниши чаще всего escalate → усилить SYSTEM_PROMPT для них
- Какие compatibility rules чаще всего нарушаются → добавить в template layer
- Какие NSFW triggers чаще всего ловятся → расширить preemptive blacklist

---

## Приложение A: План внедрения (roadmap)

### Фаза 1 (1-2 дня) — фундамент
1. Обновить `SceneSchema` (Zod): добавить `sceneType`, `emotion`, `transitionTo`, `descriptionRu`, `imagePrimarySlot`, `nsfwRisk`, `exitDirection`, `entryContinuity`.
2. Ужесточить `duration` до enum `"5"|"8"|"10"|"15"`.
3. Добавить `validateScriptCompatibility` в `script/route.ts`.
4. Расширить `sanitizePromptForNSFW` preemptive blacklist (раздел 3.4).

### Фаза 2 (2-3 дня) — template layer
5. Создать `src/lib/script-planner.ts` — детерминированный планировщик структуры (`sceneCount → [sceneType[], duration[], transition[]]`).
6. Изменить `SYSTEM_PROMPT` — LLM получает готовый скелет + генерирует только контент сцен.
7. Вынести niche guides (раздел 5.5) в отдельный модуль `src/lib/niche-guides.ts`.

### Фаза 3 (2 дня) — quality gate
8. Реализовать `computeScriptScore()` по формуле раздела 8.1.
9. Реализовать `judgeScript()` — вызов Groq LLaMA 70b с judge prompt.
10. Интегрировать в `aiCallWithQualityGate`.

### Фаза 4 (1-2 дня) — vision enrichment
11. Добавить `enrichPromptsWithVision()` — второй проход через Gemini Flash с изображениями, уточняет `@Image` сцены на основе реального контента.
12. Вставить перед quality gate.

### Фаза 5 (1 день) — observability
13. Таблица `script_generations` в Supabase.
14. Дашборд в `/dashboard` с метриками по нишам.

**Итого: 7–10 дней одного разработчика.**

---

## Приложение B: Открытые вопросы

1. **Emotion taxonomy** — какой набор эмоций? Предлагаю 15: `calm, anticipation, curiosity, wonder, desire, tension, excitement, joy, serenity, pride, melancholy, nostalgia, empowerment, intimacy, awe`.
2. **Fallback для 0 фото** — как быть если пользователь вообще ничего не загрузил? Сейчас pipeline падает или рисует рандом. Предлагаю forced-mode "generic stock" с предупреждением в UI.
3. **Multi-language brands** — что если бренд китайский/арабский? `descriptionRu` + `descriptionEn` + `descriptionOrigin`?
4. **Custom video durations** (пользовательские, не из 4 шаблонов) — когда добавлять? После MVP.

---

**END OF DESIGN DOCUMENT**
