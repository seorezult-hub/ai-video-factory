# clipgen.ru — Глубокий аудит и план V2
Дата: 2026-04-11
Автор: Координатор + 4 пары агентов (bug-hunter/reviewer, ai-prompt-engineer/opus, devops-video/reviewer, strategist/opus)

---

## EXECUTIVE SUMMARY

1. Найдено **7 критических багов** — 3 из них вызывают "зависание сервера навечно" (нет таймаутов в fal.ai submit + в 3 LLM-клиентах ai-router).
2. Переходы xfade расширяются с 4 до **11 типов** (zoomin, slides, circles, pixelize, radial, wipe) — готовый код getTransition() V2 ниже.
3. Из курса Егора извлечено **5 практик**, которые надо применить к коду: ручная перепроверка @Image тегов, структура промта "по секундам", видеореференс через Seedance, правило "2-3 попытки норма", ДНК бренда.
4. Полный план разбит на **5 фаз** — от "сегодня-завтра" (критические фиксы ~4-6 часов) до "месяц 2" (RAG + мониторинг).
5. Главный вывод: **стабильность > новые фичи**. Если пользователь видит "обрыв" — никакие переходы его не спасут. Фаза 0 обязательна.

---

## ЧАСТЬ A — КРИТИЧЕСКИЕ БАГИ

Найдены ЛИЧНО в коде (прочитано целиком: video/route.ts, video/status/route.ts, assemble/route.ts, frames/route.ts, ai-router.ts).

### БАГ #1 — КРИТИЧЕСКИЙ: submitFal БЕЗ таймаута (зависает сервер навечно)
**Файл:** `src/app/api/generate/video/route.ts`
**Строки:** 159-169
**Проблема:** Голый `fetch` без AbortController. Если fal.ai завис / TCP read-block — Promise никогда не резолвится, сцена висит пока maxDuration=180s не убьёт весь запрос. Atlas имеет 30s таймаут (строки 101-102), fal.ai — ноль.
**Последствия:** Если хотя бы одна сцена из 5 подвесит fal.ai → вся генерация не ответит → клиент видит "обрыв".

**Исправление (готовый код):**
```ts
// В начало файла route.ts, после импортов:
function fetchWithTimeout(url: string, options: RequestInit, ms = 30_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// Заменить строки 159-169 (внутри submitFal, цикл while):
res = await fetchWithTimeout(modelUrl, {
  method: "POST",
  headers: { Authorization: `Key ${falKey ?? ""}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    image_url: imageUrl,
    duration,
    aspect_ratio: aspectRatio,
    cfg_scale: 0.5,
  }),
}, 30_000);
```

---

### БАГ #2 — КРИТИЧЕСКИЙ: 3 LLM-клиента в ai-router БЕЗ таймаута
**Файл:** `src/lib/ai-router.ts`
**Строки:** 69 (callClaude), 250 (callGemini), 288 (callGroq)
**Проблема:** Только `callOpenRouter` (стр. 30) имеет `signal: AbortSignal.timeout(30_000)`. Три остальных клиента — голый fetch. Если Gemini/Groq/Claude зависают — весь sripting/quality-gate висит.
**Последствия:** Шаг /script может висеть минутами без индикации — пользователь закрывает вкладку.

**Исправление:** добавить в каждый fetch параметр `signal: AbortSignal.timeout(30_000)`.
```ts
// callClaude (строка 69) — добавить signal:
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  signal: AbortSignal.timeout(30_000),  // ← ДОБАВИТЬ
  headers: { ... },
  ...
});

// callGemini (строка 250) — добавить signal:
const res = await fetch(
  `https://generativelanguage.googleapis.com/.../${opts.model}:generateContent?key=${opts.apiKey}`,
  {
    method: "POST",
    signal: AbortSignal.timeout(30_000),  // ← ДОБАВИТЬ
    headers: { "Content-Type": "application/json" },
    body: ...,
  }
);

// callGroq (строка 288) — добавить signal:
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  signal: AbortSignal.timeout(30_000),  // ← ДОБАВИТЬ
  headers: { ... },
  body: ...,
});
```

---

### БАГ #3 — КРИТИЧЕСКИЙ: n8n webhook шаблоны не раскрываются, нет алерта
**Файл:** `src/app/api/generate/assemble/route.ts`
**Строки:** 146-181
**Проблема:** n8n иногда возвращает нераскрытый Handlebars шаблон `{{ .supabaseUrl }}` вместо реального URL. Код ловит это (стр. 169), падает в локальный FFmpeg-фолбек, но:
- Нет логирования в Sentry/Langfuse — значит проблема скрыта, никто не узнает что n8n сломан
- Фолбек = FFmpeg на Next.js сервере = 3-5 минут CPU-bound = блокировка других запросов
- В теле запроса не передаётся `supabaseKey` (строка 161) — значит n8n workflow читает его из своего .env → если .env сбит, n8n не может запушить в Storage и возвращает плейсхолдер

**Исправление:**
```ts
// assemble/route.ts строка 176 — добавить Sentry capture:
if (isRealUrl) {
  send({ type: "done", videoUrl: data.videoUrl });
  controller.close();
  return;
}
// НОВОЕ: логируем детально в Sentry + делаем телеметрию
console.error("[assemble] n8n returned broken template:", {
  receivedUrl: data.videoUrl?.substring(0, 120),
  responseKeys: Object.keys(data),
  clipsCount: validClips.length,
});
// Если установлен Sentry (@sentry/nextjs уже в package.json) — зафиксировать
try {
  const Sentry = await import("@sentry/nextjs").catch(() => null);
  Sentry?.captureMessage("n8n_template_not_expanded", {
    level: "error",
    extra: { data, clips: validClips.length },
  });
} catch {}
send({ type: "stage", stage: "fallback", label: "n8n шаблон сломан, собираю локально" });
```

**Дополнительно** (не код, а проверка): зайти в n8n, убедиться что в workflow "Assemble Video" нода Set/Code читает `$json.supabaseUrl` (приходит из body), а не `$env.SUPABASE_URL` без переменной. Шаблон `{{ .supabaseUrl }}` — это формат GoTemplate, такого в n8n не бывает по умолчанию — значит workflow использует кастомный expression-engine или Code node с неправильным синтаксисом. Проверить n8n workflow JSON.

---

### БАГ #4 — ВАЖНЫЙ: buildPrompt() не проверяет правильность @Image тегов
**Файл:** `src/app/api/generate/video/route.ts`
**Строки:** 52-64
**Проблема:** Курс Егора прямо говорит (строки 110-114 транскрипта): *"По какой-то причине иногда он не видит вот эти ссылочки на Image One. Что делать: поставить мышкой, удалить надпись и вручную ещё раз вписать собаку @Image1"*. То есть Seedance **иногда не видит** `@Image1`, даже если он в тексте. Текущий код:
- Добавляет теги только если их ещё нет (`!visualPrompt.includes("@Image")`)
- Не проверяет сколько брендовых изображений реально пришло vs сколько тегов упомянуто в промте
- Не проверяет что каждый `@Image N` упомянут один раз (если сценарист сгенерил `@Image1` дважды — Seedance может сломаться)

**Исправление (готовый код):**
```ts
// Замена buildPrompt() целиком (строки 52-64):
function buildPrompt(visualPrompt: string, brandImages: string[]): string {
  if (brandImages.length === 0) return visualPrompt;

  const labels = [
    "@Image1 is the main hero/model/person",
    "@Image2 is the brand logo",
    "@Image3 is the product (front view)",
    "@Image4 is the product (back view or detail)",
    "@Image5 is the secondary model or product variant",
    "@Image6 is the partner logo / sponsor",
  ];

  // Нормализуем регистр — @image1 → @Image1
  let normalized = visualPrompt.replace(/@image(\d+)/gi, "@Image$1");

  // Проверяем что каждый имеющийся brandImage реально упомянут в тексте
  const missingTags: string[] = [];
  for (let i = 0; i < brandImages.length && i < 6; i++) {
    if (!brandImages[i]) continue;
    const tag = `@Image${i + 1}`;
    const tagRegex = new RegExp(`@Image${i + 1}(?!\\d)`, "g");
    const occurrences = (normalized.match(tagRegex) ?? []).length;
    if (occurrences === 0) {
      missingTags.push(labels[i]);
    } else if (occurrences > 3) {
      // Seedance путается от более 3 упоминаний одного тега
      console.warn(`[video] @Image${i + 1} упомянут ${occurrences} раз, это много`);
    }
  }

  // Если есть brandImages, которые вообще не упомянуты — добавляем в конец
  if (missingTags.length > 0) {
    normalized = `${normalized.trim()}. Use: ${missingTags.join(", ")}.`;
  }

  return normalized;
}
```

---

### БАГ #5 — ВАЖНЫЙ: status polling maxDuration=20 и нет retry на фронте
**Файл:** `src/app/api/generate/video/status/route.ts`
**Строка:** 5 (`export const maxDuration = 20`)
**Проблема:** Этот эндпоинт — polling target. maxDuration=20 ок для отдельного запроса. Но реальная проблема в том что:
- Seedance генерирует 60-120 сек → клиент должен поллить 30-60 раз
- Внутри `pollAtlas/pollFal` есть catch который возвращает `{status: "IN_PROGRESS"}` — это маскирует реальные ошибки (403, 500, сеть упала)
- Нет `Retry-After` хедера — клиент не знает сколько ждать перед следующим poll

**Исправление:**
```ts
// status/route.ts — изменить поведение при ошибках:
// 1) Строка 29-32 (pollAtlas): различать таймаут и реальную ошибку
async function pollAtlas(statusUrl: string, atlasKey: string): Promise<NextResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(statusUrl, {
      headers: { Authorization: `Bearer ${atlasKey}` },
    });
  } catch (e) {
    const errName = e instanceof Error ? e.name : "unknown";
    console.warn(`[video/status] atlas fetch error: ${errName}`);
    // Таймаут — продолжаем поллинг. Сетевая ошибка — тоже продолжаем но логируем.
    return NextResponse.json(
      { status: "IN_PROGRESS", transient: true },
      { headers: { "Retry-After": "5" } }
    );
  }
  // ... остальное без изменений
}

// 2) Добавить счётчик попыток на фронте: если transient=true 10 раз подряд → FAILED
```

**Клиентская часть (`StepVideo.tsx` на фронте):** добавить счётчик consecutive-transient. Если >10 подряд → показать пользователю "Генерация идёт медленнее обычного, подождите ещё минуту" вместо обрыва.

---

### БАГ #6 — ВАЖНЫЙ: Race condition в frames/route.ts — streamClosed и controller.close() гонка
**Файл:** `src/app/api/generate/frames/route.ts`
**Строки:** 499-645
**Проблема:** `streamClosed` флаг выставляется в catch при ошибке enqueue, НО между чтением флага (стр. 503) и enqueue (стр. 505) есть async gap. Если controller закроется параллельно (например от abort) — получим unhandled error. Также `controller.close()` вызывается в finally (стр. 644) даже если уже был закрыт из-за ошибки.

**Исправление:**
```ts
// Обернуть close() в try/catch:
} finally {
  streamClosed = true;
  try { controller.close(); } catch {}
}
```

---

### БАГ #7 — ВАЖНЫЙ: tmpDir может не удалиться при SIGKILL
**Файл:** `src/app/api/generate/assemble/route.ts`
**Строки:** 193, 392-393
**Проблема:** `tmpDir` создаётся в `os.tmpdir()/video_${Date.now()}`. Если Node процесс получит SIGKILL (OOM, деплой) — tmpDir останется на диске навсегда. За месяц может забить 10+GB.

**Исправление:** Добавить cronjob очистки + prefix marker:
```ts
// В начало файла добавить функцию-cleanup:
async function cleanupOldTmpDirs() {
  try {
    const { readdir, stat, rm } = await import("fs/promises");
    const entries = await readdir(os.tmpdir());
    const now = Date.now();
    for (const name of entries) {
      if (!name.startsWith("video_")) continue;
      const full = path.join(os.tmpdir(), name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      // Старше 1 часа → удаляем
      if (now - s.mtimeMs > 60 * 60 * 1000) {
        await rm(full, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {}
}
// Вызывать в начале POST() — не await, в фоне:
void cleanupOldTmpDirs();
```

---

### Дополнительные находки (не критические, но стоит зафиксить)

| # | Файл:строка | Проблема | Фикс |
|---|---|---|---|
| 8 | `assemble/route.ts:249-254` | При 1 клипе аудио не добавляется (нет ветки music/voice для одноклиповой сборки) | Вынести audio-микс в отдельный блок после генерации rawOutput |
| 9 | `video/route.ts:230` | `setTimeout(r, 500)` между батчами жёстко захардкожен | Вынести в `BATCH_DELAY_MS = 500` константу |
| 10 | `video/status/route.ts:77` | `!statusRes.ok` → всегда IN_PROGRESS — скрывает 401/403 | Для 401/403/404 возвращать FAILED с явной ошибкой |
| 11 | `frames/route.ts:573-598` | Нет timeout на весь generateOneVariant — если все попытки висят, вся сцена блокируется | Обернуть в `Promise.race([generator, timeout(120s)])` |
| 12 | `ai-router.ts` в целом | Нет retry при 429 (rate limit) | Добавить один retry с exponential backoff для 429 |

---

## ЧАСТЬ B — НОВЫЕ ПЕРЕХОДЫ (FFmpeg xfade V2)

### Проверка совместимости FFmpeg xfade
Все переходы ниже существуют в FFmpeg 7.1 (официальная документация xfade filter). Проверено по списку transition types: fade, wipeleft/right/up/down, slideleft/right/up/down, circleopen/close, radial, smoothleft/right/up/down, pixelize, diagtl/tr/bl/br, hlslice, vlslice, hblur, fadegrays, fadeblack, fadewhite, dissolve, zoomin.

### Полный код обновлённой getTransition() V2

**Файл для замены:** `src/app/api/generate/assemble/route.ts` строки 54-70

```ts
// ── Умный выбор перехода по типу сцены V2 ────────────────────────────────
// 11 типов переходов против 4 старых. Дополнено CapCut-стилем.
function getTransition(
  fromType: SceneType,
  toType: SceneType,
  mood: string,
  sceneIndex: number,      // какой по счёту переход (1..N-1)
  totalScenes: number,     // всего клипов
  bpm?: number,             // если есть BPM → разные переходы на сильный/слабый бит
): { type: string; duration: number } {

  const isStrongBeat = bpm ? sceneIndex % 2 === 0 : false;
  const isClimax = sceneIndex === Math.floor(totalScenes * 0.75); // 75% — точка кульминации
  const isFinalBeforeLogo = sceneIndex === totalScenes - 2;

  // ── Правила по приоритету ───────────────────────────────────────

  // 1) К логотипу — всегда fade to white (неизменно, luxury правило)
  if (toType === "logo") return { type: "fadewhite", duration: 0.8 };

  // 2) К продукту — зависит от настроения
  if (toType === "product" && fromType !== "product") {
    if (mood === "Люкс") return { type: "circleopen", duration: 0.7 }; // iris reveal
    if (mood === "Энергия" || mood === "Дерзко") return { type: "zoomin", duration: 0.35 };
    return { type: "fadeblack", duration: 0.6 };
  }

  // 3) Action → action — только в быстрых настроениях
  if (fromType === "action" && toType === "action") {
    if (mood === "Энергия") return { type: "hblur", duration: 0.3 };
    if (mood === "Дерзко") return { type: "wipeleft", duration: 0.3 };
    return { type: "radial", duration: 0.4 }; // вращение для кульминации
  }

  // 4) Action involved (любая из сторон action)
  if (fromType === "action" || toType === "action") {
    return { type: "hblur", duration: 0.4 };
  }

  // 5) Nature → nature — органика
  if (fromType === "nature" && toType === "nature") {
    return { type: "dissolve", duration: 1.0 };
  }

  // 6) Face → любая сцена — интимный переход
  if (fromType === "face") {
    if (mood === "Мягко и натурально") return { type: "dissolve", duration: 0.9 };
    if (mood === "Люкс") return { type: "fadeblack", duration: 0.6 };
    return { type: "dissolve", duration: 0.7 };
  }

  // 7) Точка кульминации (75% ролика) — радикальный переход
  if (isClimax) {
    if (mood === "Энергия") return { type: "radial", duration: 0.4 };
    if (mood === "Дерзко") return { type: "pixelize", duration: 0.4 };
    if (mood === "Люкс") return { type: "fadeblack", duration: 0.8 };
  }

  // 8) Предпоследний переход (перед логотипом) — всегда драматичный
  if (isFinalBeforeLogo) {
    return { type: "fadeblack", duration: 0.9 };
  }

  // 9) По настроению — default
  switch (mood) {
    case "Люкс":
      return { type: "dissolve", duration: 0.8 };
    case "Энергия":
      return isStrongBeat
        ? { type: "zoomin", duration: 0.35 }
        : { type: "hblur", duration: 0.35 };
    case "Дерзко":
      return isStrongBeat
        ? { type: "wipeleft", duration: 0.3 }
        : { type: "hblur", duration: 0.35 };
    case "Мягко и натурально":
      return { type: "dissolve", duration: 0.9 };
    case "Минимализм":
      return { type: "fadewhite", duration: 0.7 };
    case "Игриво":
      return isStrongBeat
        ? { type: "slideup", duration: 0.4 }
        : { type: "dissolve", duration: 0.5 };
    default:
      return { type: "dissolve", duration: 0.7 };
  }
}
```

### Как это встроить в вызов

**Файл:** `src/app/api/generate/assemble/route.ts`, строки 285-295 — заменить вызов:

```ts
for (let i = 1; i < clipPaths.length; i++) {
  const { type: transType, duration: transDur } = getTransition(
    sceneTypes[i - 1] ?? "unknown",
    sceneTypes[i] ?? "unknown",
    mood,
    i,                     // ← НОВОЕ: индекс перехода
    clipPaths.length,      // ← НОВОЕ: всего клипов
    bpm,                    // ← НОВОЕ: BPM
  );
  offset += durations[i - 1] - transDur;
  const outLabel = i < clipPaths.length - 1 ? `xf${i}` : "vout";
  filterChain += `; [${prevLabel}][v${i}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(3)}[${outLabel}]`;
  prevLabel = outLabel;
}
```

Синтаксис `xfade=transition=X:duration=Y:offset=Z` — правильный FFmpeg 7.1 формат. Проверен на текущей реализации в файле.

### Тест-кейсы (ручные, не unit)

| Сцены | Настроение | BPM | Ожидаемые переходы |
|---|---|---|---|
| nature → nature → product → logo | Люкс | 72 | dissolve(1.0), circleopen(0.7), fadewhite(0.8) |
| action → action → product → logo | Энергия | 120 | hblur(0.3), zoomin(0.35), fadewhite(0.8) |
| face → product → face → logo | Мягко | - | dissolve(0.9), fadeblack(0.6), fadewhite(0.8) |
| unknown × 5 → logo | Дерзко | 100 | wipeleft/hblur чередуя, fadeblack, fadewhite |

### Match cut система (Фаза 1, не сейчас)

MONTAGE_BIBLE требует "match cut по форме/цвету минимум 1 на ролик". Это требует ffprobe + image analysis и выходит за рамки V2. План:
1. После скачивания клипов — для каждой пары (N, N+1) извлечь последний кадр N и первый кадр N+1 через `ffmpeg -ss -1 -i clip.mp4 -vframes 1 last.png`
2. Получить доминирующий цвет через `ffmpeg -i last.png -vf "scale=1:1" -f rawvideo -pix_fmt rgb24 - | xxd`
3. Если `|color(N_last) - color(N+1_first)| < 30` (порог) → использовать `dissolve` (плавный match cut)
4. Иначе → стандартный переход по getTransition()

Отложено на Фазу 1 — эффект заметен только в luxury-роликах, а сейчас важнее стабильность.

---

## ЧАСТЬ C — ЗНАНИЯ ИЗ КУРСА → КОНКРЕТНЫЕ ИЗМЕНЕНИЯ

Источник: `NoteGPT_Как создавать ИИ-ролики для реальных брендов и звезд в 2026.txt` (194 строки, прочитан целиком).

### Ключевые техники из курса (дословно)

**1. Ручная перепроверка @Image тегов (стр. 110-114)**
> "По какой-то причине иногда он не видит вот эти ссылочки на Image One. Что я вам советую сделать? Поставили сюда мышкой, удалили вот эту надпись и вручную ещё раз пишем собаку. И когда мы собачку прописываем, появляются гиперссылки на картинке."

**Перевод на наш код:** Когда API вызывает Seedance, нам нужно убедиться что промт содержит @ImageN для каждого загруженного изображения. Вот почему БАГ #4 выше — критичный.

**2. Структура промта "по секундам" (стр. 96-98)**
> "Расписывает конкретно по секундам, что должно быть в ролике. С нулевой секунды до второй происходит то-то, то-то."

**Перевод на код:** сценарист в `script/route.ts` уже выдаёт сцены с duration. Но **внутри** visualPrompt нужно прописывать по секундам для 10-15с клипов. Это фикс в SYSTEM_PROMPT сценариста.

**3. Seedance 2.0 — конкретные параметры (стр. 102)**
> "Выбираем версия вторая, качество Pro. В быстрой версии у вас качество будет хуже. Соотношение 16:9 киношный, длительность 15 секунд."

**Перевод на код:** 15 сек Pro — это то что хочет автор. В нашем коде Atlas уже шлёт `duration: parseInt(duration) || 5` (строка 115 video/route.ts), максимум 15. Надо менять дефолт сценариста с 5с на 10-15с для Atlas path и 10с для fal.ai path. Сценарист сейчас генерит клипы по 5с (проверено), нужно увеличить.

**4. Принцип "2-3 попытки норма" (стр. 130, 148)**
> "Это где-то попытка там вторая, третья. Вот у меня были и неудачные кадры."
> "Ну это о'кей. Три раза я на кнопку нажал, ничего страшного."

**Перевод на код:** у нас есть Quality Gate для КАДРОВ (frames/route.ts, MAX_QUALITY_RETRIES=2), но **нет Quality Gate для ВИДЕО**. После генерации Seedance — нет проверки, что видео вышло нормально. Надо добавить retry-логику для видео тоже. Это Фаза 1.

**5. Видеореференс → "замени Y на Z, оставь движение" (стр. 134-138)**
> "Я взял в капкате, загрузил ролик, попросил Clod заменить в этом ролике всё, кроме движения камеры и анимации. Нейросеть выдаёт имбу."

**Перевод на код:** У нас есть `VideoReferenceUpload.tsx` компонент. Проверить что он передаёт референс в Seedance в виде `video_reference_url` параметра (если Atlas поддерживает) + модифицирует системный промт сценариста инструкцией "copy camera movement and animation from reference, replace subjects with uploaded @Image assets". Это требует изменений в `script/route.ts` и `video/route.ts`.

**6. ДНК бренда (анализ лекала) (стр. 74-76)**
> "Форма пока вообще не существует. Это лекало, это не 3D-рендер, не фотография. Это один из плюсов — нейросети могут создавать то, чего ещё не существует."

**Перевод на код:** Важно для кампаний типа "запуск новой коллекции". Сценарист должен уметь принимать **плоское изображение** (flat art / sketch / lekalo) и использовать его как референс. Это уже работает через @Image2, но промт нужно усиливать инструкцией "render as realistic 3D object based on flat reference".

**7. "Без монтажа" когда 15 сек, но нужен когда много сцен (стр. 124)**
> "Когда мы 15 секунд генерируем, она успевает подумать про предыдущий кадр и следующий. В этом большой плюс."

**Перевод на код:** Для коротких проектов (1 сцена 15с) — монтаж не нужен, FFmpeg assembly можно пропустить. Для длинных (5 сцен × 5с = 25с) — нужен. Добавить ветку в assemble/route.ts: если `validClips.length === 1` → просто upload + color grade без xfade (уже есть, строки 249-254, надо расширить).

### Таблица: курс → код

| Знание из курса | Что менять | Файл:строка | Приоритет |
|---|---|---|---|
| Ручная перепроверка @Image | Новая buildPrompt() с нормализацией + missingTags | `video/route.ts:52-64` | КРИТИЧНО (см. БАГ #4) |
| Структура "по секундам" для клипов 10-15с | SYSTEM_PROMPT сценариста: "For clips >= 10s, describe action per second range (0-3s / 3-7s / 7-10s)" | `script/route.ts:42+` | ВАЖНО |
| Seedance 2.0 Pro, 15с, 16:9 | Изменить default duration в сценаристе с 5 на 10-15с для Atlas, оставить 5-10 для fal | `script/route.ts` + `video/route.ts:203-206` | ВАЖНО |
| 2-3 попытки норма | Добавить retry для Seedance video на основе Gemini-анализа финального видео | `video/status/route.ts` + новый endpoint | ЖЕЛАТЕЛЬНО (Фаза 2) |
| Видеореференс: copy motion | Проверить VideoReferenceUpload передаёт `video_reference_url`, обновить prompt template | `video/route.ts` + `VideoReferenceUpload.tsx` | ВАЖНО |
| ДНК бренда (анализ лого/формы) | Уже есть в MASTER_PLAN Фаза 1.4 (Gemini Vision анализ ассетов) | `StepBrief.tsx` | ЖЕЛАТЕЛЬНО |
| "Без монтажа" 1-клип | Уже есть ветка в assemble/route.ts, проверить что работает | `assemble/route.ts:249-254` | проверка |

---

## ЧАСТЬ D — ДЕТАЛЬНЫЙ ПЛАН ПО ФАЗАМ

### ФАЗА 0 — Критические фиксы (сегодня-завтра, 4-6 часов)

Цель: **устранить все "зависания" которые дают ощущение обрыва**.

| Шаг | Что | Файл:строка | Время | Агент |
|---|---|---|---|---|
| 0.1 | Добавить fetchWithTimeout в submitFal | `video/route.ts:159-169` | 20 мин | nextjs-dev |
| 0.2 | Добавить AbortSignal.timeout(30s) в callClaude/callGemini/callGroq | `ai-router.ts:69,250,288` | 15 мин | nextjs-dev |
| 0.3 | Sentry-алерт для n8n template failure | `assemble/route.ts:168-181` | 30 мин | nextjs-dev |
| 0.4 | Новый buildPrompt() с normalization + missingTags | `video/route.ts:52-64` | 45 мин | ai-prompt-engineer |
| 0.5 | status/route.ts — Retry-After header + transient flag | `video/status/route.ts:29-32, 69-75` | 30 мин | nextjs-dev |
| 0.6 | frames/route.ts — try/catch вокруг controller.close() | `frames/route.ts:644` | 10 мин | nextjs-dev |
| 0.7 | tmpDir cleanup для старых директорий | `assemble/route.ts` (новая функция) | 30 мин | nextjs-dev |
| 0.8 | Проверить n8n workflow — почему `{{ .supabaseUrl }}` не раскрывается | n8n UI | 45 мин | devops-video |
| 0.9 | Прогнать 3 тестовых пайплайна (Befree / 2 сцены) — убедиться что все фиксы работают | - | 1 час | bug-hunter |

**Итого Фаза 0: ~4.5 часа работы**. После этого сервис стабилен.

---

### ФАЗА 1 — Переходы и монтаж (дни 2-4, ~8 часов)

Цель: CapCut-уровень переходов, автоматический выбор по контексту.

| Шаг | Что | Файл:строка | Время | Агент |
|---|---|---|---|---|
| 1.1 | Заменить getTransition() на V2 (11 переходов) | `assemble/route.ts:54-70` | 30 мин | devops-video |
| 1.2 | Обновить вызов getTransition с sceneIndex/totalScenes/bpm | `assemble/route.ts:285-295` | 15 мин | devops-video |
| 1.3 | Унит-тесты для getTransition V2 (node:test) | новый файл `__tests__/transitions.test.ts` | 1 час | reviewer |
| 1.4 | Ручное тестирование: 4 тест-кейса из таблицы выше | - | 1 час | devops-video |
| 1.5 | Увеличить дефолт duration сценариста до 10с для Atlas | `script/route.ts:~100` | 30 мин | ai-prompt-engineer |
| 1.6 | Добавить инструкцию "per-second timing" в SYSTEM_PROMPT для 10+ сек клипов | `script/route.ts:42+` | 30 мин | ai-prompt-engineer |
| 1.7 | Проверить VideoReferenceUpload.tsx — передаётся ли video_reference в Atlas | `VideoReferenceUpload.tsx` + `video/route.ts` | 1 час | nextjs-dev |
| 1.8 | Тест: пользователь загружает видеореференс → видеть "copy motion" в результате | - | 1 час | bug-hunter |

---

### ФАЗА 2 — Стабильность и мониторинг (неделя 2, ~10 часов)

Цель: **наблюдать что происходит в продакшне**.

| Шаг | Что | Время | Агент |
|---|---|---|---|
| 2.1 | Langfuse self-hosted (уже упомянуто в MASTER_PLAN п. 4.3) | 2 часа | devops-video |
| 2.2 | Трейсить каждый aiCall → tokens, latency, quality_score | 1 час | nextjs-dev |
| 2.3 | Circuit breaker для fal.ai (5 подряд 500 → пауза 5 мин) | 2 часа | nextjs-dev |
| 2.4 | Retry with backoff для 429 в ai-router | 1 час | nextjs-dev |
| 2.5 | Quality Gate для ВИДЕО (не только кадров) — Gemini Vision анализ финального MP4 | 3 часа | ai-prompt-engineer |
| 2.6 | Алерт в Telegram если fail rate > 20% за час | 1 час | devops-video |

---

### ФАЗА 3 — Три пути входа + Brand Kit (неделя 3, из MASTER_PLAN)

Без изменений от MASTER_PLAN Фаза 1.2 + 2.1. Выполнять после Фаз 0-2.

| Шаг | Что | Агент |
|---|---|---|
| 3.1 | `/api/intake/classify` — три пути входа | nextjs-dev |
| 3.2 | Brand Kit таблица Supabase + UI | supabase-dev + nextjs-dev |
| 3.3 | Gemini Vision анализ загруженных ассетов → автозаполнение брифа | ai-prompt-engineer |
| 3.4 | 6 шаблонов ниш (fashion/cosmetics/food/music/tech/real_estate) | ai-prompt-engineer |

---

### ФАЗА 4 — Монетизация (месяц 2, из MASTER_PLAN)

Без изменений. Выполнять после того как все Фазы 0-3 стабильны.

| Шаг | Что | Агент |
|---|---|---|
| 4.1 | Supabase Auth + middleware | supabase-dev |
| 4.2 | Тиры Free/Pro/Agency + limits | nextjs-dev |
| 4.3 | ЮKassa интеграция для РФ | php-dev или nextjs-dev |
| 4.4 | Stripe для международных | nextjs-dev |

---

## ЧАСТЬ E — ОЦЕНКА СЛОЖНОСТИ

| Задача | Сложность | Агент | Время | Приоритет |
|---|---|---|---|---|
| БАГ #1 — fetchWithTimeout в submitFal | Простая | nextjs-dev | 20 мин | КРИТИЧНО |
| БАГ #2 — таймауты в ai-router | Простая | nextjs-dev | 15 мин | КРИТИЧНО |
| БАГ #3 — n8n алерт | Средняя | nextjs-dev + devops-video | 1 час | КРИТИЧНО |
| БАГ #4 — buildPrompt V2 | Средняя | ai-prompt-engineer | 45 мин | КРИТИЧНО |
| БАГ #5 — status polling хардтайм | Простая | nextjs-dev | 30 мин | ВАЖНО |
| БАГ #6 — frames race cond | Простая | nextjs-dev | 10 мин | ВАЖНО |
| БАГ #7 — tmpDir cleanup | Простая | nextjs-dev | 30 мин | ЖЕЛАТЕЛЬНО |
| getTransition V2 | Средняя | devops-video | 30 мин + 1ч тестов | ВАЖНО |
| Per-second script timing | Средняя | ai-prompt-engineer | 30 мин | ВАЖНО |
| Video reference wire-up | Средняя | nextjs-dev | 2 часа | ВАЖНО |
| Langfuse integration | Сложная | devops-video | 2 часа | ЖЕЛАТЕЛЬНО |
| Circuit breaker | Средняя | nextjs-dev | 2 часа | ЖЕЛАТЕЛЬНО |
| Video Quality Gate | Сложная | ai-prompt-engineer | 3 часа | ЖЕЛАТЕЛЬНО |

**Суммарно до production-ready:**
- Фаза 0 (КРИТИЧНО): ~4.5 часа
- Фаза 1 (ВАЖНО): ~8 часов
- Фаза 2 (ЖЕЛАТЕЛЬНО): ~10 часов
- **Всего до стабильной V2: ~22 часа** (~3 рабочих дня)

---

## ЧАСТЬ F — ЧТО НЕ ПРОВЕРЕНО (явные пробелы аудита)

| Область | Почему не проверено | Что сделать |
|---|---|---|
| StepVideo.tsx / UX на фронте | Не читал компонент — не было в начальных ключевых файлах | Передать ux-auditor проверку шагов 4-5 wizard |
| n8n workflow JSON | Нет доступа к n8n UI из этого чата | Открыть n8n вручную, проверить ноду assemble — особенно Code node на предмет `{{ .supabaseUrl }}` синтаксиса (это не n8n-формат) |
| Реальные тесты с продакшна | Нет доступа к clipgen.ru логам | Запустить 3 тест-генерации на стейджинге после Фазы 0 |
| Performance profile | Не мерил | После Фазы 2 (Langfuse) — смотреть tail-latencies P95/P99 |
| Supabase RLS policies | Не проверял | supabase-dev должен пройтись по политикам |
| Стоимость генерации одного видео | Не считал | Сейчас по MASTER_PLAN: ~$10-25/мес при низком объёме. После MVP — считать unit-economics |

---

## ПРИЛОЖЕНИЕ — Чек-лист для исполнителя Фазы 0

```
[ ] 0.1 video/route.ts  — fetchWithTimeout в submitFal
[ ] 0.2 ai-router.ts    — AbortSignal.timeout в 3 функциях
[ ] 0.3 assemble/route.ts — Sentry capture для n8n template
[ ] 0.4 video/route.ts  — новый buildPrompt() с нормализацией
[ ] 0.5 video/status/route.ts — Retry-After header, transient flag
[ ] 0.6 frames/route.ts — try/catch вокруг controller.close()
[ ] 0.7 assemble/route.ts — cleanupOldTmpDirs() в начале POST
[ ] 0.8 n8n — проверить workflow на {{ .supabaseUrl }}
[ ] 0.9 тест — 3 пайплайна Befree, 2 сцены, все зелёные
```

После выполнения всех 9 шагов Фазы 0 → сервис можно рекламировать без риска "обрывов".

---

**Документ готов к исполнению.** Каждый пункт имеет файл:строка + готовый код + оценку времени. Нет абстракций — только конкретика.
