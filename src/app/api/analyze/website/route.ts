import { NextRequest, NextResponse } from "next/server";
import { parseJSON } from "@/lib/ai-router";
import { aiCallWithQualityGate } from "@/lib/ai-validator";

export const runtime = "nodejs";

// Промпт для извлечения базовых данных из скрапа
const EXTRACT_PROMPT = `Проанализируй текстовый контент главной страницы сайта и верни ТОЛЬКО JSON объект.

ВАЖНО: все поля обязательны. НИКОГДА не пиши "Неизвестно", "Unknown", "N/A" или пустую строку. Если данных нет явно — ОБЯЗАТЕЛЬНО выведи логически исходя из названия бренда, продукта и позиционирования. Лучше угадать правдоподобно, чем оставить пустым.

Формат ответа — строго JSON, без markdown, без объяснений:
{
  "brandName": "название бренда или компании — обязательно",
  "productDescription": "что продают / какие услуги, 1-2 предложения — обязательно",
  "targetAudience": "целевая аудитория: пол, возраст, интересы — ОБЯЗАТЕЛЬНО, даже если не указано явно: выведи логически из продукта и позиционирования. Пример: Мужчины 25-45, ценят роскошь и статус",
  "brandColors": "ОБЯЗАТЕЛЬНО 2-3 цвета: если не упомянуты явно — угадай по позиционированию. luxury парфюм → золото, чёрный, синий. eco food → зелёный, бежевый. tech → синий, белый, серый. Всегда пиши цвета через запятую.",
  "videoType": "один из: cosmetics, fashion, food, music, tech, real_estate — подходящий для этого бизнеса",
  "mood": "один из: Люкс, Энергия, Мягко и натурально, Дерзко, Минимализм, Игриво",
  "region": "город/регион если указан, иначе пустая строка",
  "jtbdSummary": "2-3 предложения — главные боли и желания целевой аудитории этого бренда"
}

КОНТЕНТ САЙТА:
{CONTENT}`;

// 12-фазный анализ (сокращённая версия для передачи в генератор сценария)
const JTBD_PROMPT = `Ты Senior UX Researcher и видеопродюсер для брендов.

Данные о бизнесе:
{BASE_DATA}

Сделай краткий анализ для создания видеорекламы. Ответь строго в JSON:
{
  "keyPains": ["боль 1", "боль 2", "боль 3"],
  "keyDesires": ["желание 1", "желание 2", "желание 3"],
  "emotionalTriggers": ["триггер 1", "триггер 2"],
  "videoAngle": "главный угол для видеорекламы — какую проблему/желание показать",
  "toneOfVoice": "тон коммуникации: luxury/friendly/energetic/trust/aspirational",
  "callToAction": "лучший призыв к действию для этого бизнеса"
}`;

// Блокируем приватные IP и небезопасные схемы (SSRF protection)
function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname;
    // IPv4 private/loopback
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return false;
    if (h === "169.254.169.254" || h === "metadata.google.internal") return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    // IPv6 private/loopback
    if (h === "::1" || h === "[::1]") return false;
    if (/^\[?fc/i.test(h) || /^\[?fd/i.test(h)) return false; // ULA fc00::/7
    if (/^\[?fe80/i.test(h)) return false; // link-local
    if (/^\[?::ffff:/i.test(h)) return false; // IPv4-mapped
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;

  if (!url) {
    return NextResponse.json({ error: "URL не указан" }, { status: 400 });
  }

  if (!isSafeUrl(url)) {
    return NextResponse.json({ error: "Недопустимый URL" }, { status: 400 });
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;

  const { resolveApiKey } = await import("@/lib/user-keys");
  const groqKey = await resolveApiKey("groq", process.env.GROQ_API_KEY);

  if (!groqKey) {
    return NextResponse.json({ error: "GROQ_API_KEY не настроен" }, { status: 500 });
  }

  // Шаг 1: Скрапинг через Firecrawl
  let markdown = "";

  if (firecrawlKey) {
    try {
      const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats: ["markdown"] }),
      });

      if (scrapeRes.ok) {
        const scrapeData = await scrapeRes.json();
        markdown = scrapeData?.data?.markdown ?? "";
      }
    } catch {
      // Fallback to basic fetch
    }
  }

  // Fallback: если нет Firecrawl или он упал — пробуем простой fetch
  if (!markdown) {
    try {
      const pageRes = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Video-Factory/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (pageRes.status >= 300 && pageRes.status < 400) throw new Error("SSRF: redirect blocked");
      const html = await pageRes.text();
      // Грубая очистка HTML → текст
      markdown = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 15000);
    } catch {
      return NextResponse.json({ error: "Не удалось получить содержимое сайта" }, { status: 502 });
    }
  }

  const safeContent = markdown.substring(0, 20000);

  // Если контента мало (JS-рендерный сайт) — добавляем URL как подсказку для AI
  const contentForAI = safeContent.length < 300
    ? `URL сайта: ${url}\n\nКонтент недоступен (JS-рендеринг). Используй свои знания об этом бренде/компании из URL для заполнения всех полей.`
    : `URL сайта: ${url}\n\n${safeContent}`;

  // Шаг 2: Извлечение базовых данных (Flash-Lite + quality gate)
  const extractResult = await aiCallWithQualityGate({
    task: "extract",
    system: "Ты аналитик данных. Отвечай ТОЛЬКО валидным JSON, без объяснений и markdown.",
    user: EXTRACT_PROMPT.replace("{CONTENT}", contentForAI),
  });
  if (!extractResult.ok) {
    return NextResponse.json({ error: extractResult.error }, { status: 502 });
  }

  const brandData = parseJSON<Record<string, string>>(extractResult.text);
  if (!brandData) {
    return NextResponse.json({ error: "Не удалось распарсить данные бренда" }, { status: 500 });
  }

  // Шаг 3: JTBD-анализ (Flash + quality gate)
  const jtbdResult = await aiCallWithQualityGate({
    task: "analyze",
    system: "Ты Senior UX Researcher и видеопродюсер. Отвечай ТОЛЬКО валидным JSON, без объяснений и markdown.",
    user: JTBD_PROMPT.replace("{BASE_DATA}", JSON.stringify(brandData, null, 2)),
  });

  const jtbd = jtbdResult.ok ? (parseJSON<Record<string, unknown>>(jtbdResult.text) ?? {}) : {};

  return NextResponse.json({ brandData, jtbd });
}
