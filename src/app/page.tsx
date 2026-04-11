import Link from "next/link";
import { BalanceDashboard } from "@/components/BalanceDashboard";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const NICHES = [
  "Парфюм / Люкс",
  "Косметика",
  "Мода / Одежда",
  "Еда / Рестораны",
  "Спорт / Фитнес",
  "Недвижимость",
  "Музыкальный клип",
  "Гаджеты / Техника",
];

const ENTRY_PATHS = [
  {
    icon: "🗂️",
    title: "Есть фото и логотип",
    desc: "Загружаете ассеты — система пишет сценарий, генерирует кадры и собирает ролик под ваш бренд",
    cta: "Начать с ассетами →",
    href: "/create?mode=full",
    accent: "from-purple-600 to-violet-600",
    badge: "Полный контроль",
  },
  {
    icon: "💡",
    title: "Только идея",
    desc: "Опишите продукт — ИИ задаст умные вопросы, сам создаст ТЗ, промты и всё необходимое",
    cta: "Начать с идеи →",
    href: "/create?mode=idea",
    accent: "from-indigo-600 to-blue-600",
    badge: "ИИ-помощник",
  },
  {
    icon: "🏆",
    title: "Под ключ",
    desc: "Отправляете ТЗ — мы делаем всё: референсы, Brand Kit, сценарий, монтаж, субтитры, озвучка",
    cta: "Оставить заявку →",
    href: "/create?mode=service",
    accent: "from-amber-600 to-orange-600",
    badge: "Белый лейбл",
  },
];

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-5">
          <div className="inline-block bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold px-3 py-1.5 rounded-full uppercase tracking-widest">
            Seedance 2.0 Pro · Atlas Cloud
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight leading-tight">
            AI-ролики для брендов<br />
            <span className="text-purple-400">— за 30 минут</span>
          </h1>
          <p className="text-lg text-slate-300 max-w-xl mx-auto">
            Дior Sauvage, Chanel, YSL — такой уровень. Без монтажа, без опыта.
            Один промт = готовый рекламный ролик с переходами и музыкой.
          </p>

          {/* Steps */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm text-slate-300 max-w-2xl mx-auto pt-2">
            {[
              { step: "01", label: "Бриф" },
              { step: "02", label: "Сценарий" },
              { step: "03", label: "Кадры" },
              { step: "04", label: "Видео" },
              { step: "05", label: "Монтаж" },
              { step: "06", label: "Скачать" },
            ].map(({ step, label }) => (
              <div
                key={step}
                className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1"
              >
                <div className="text-purple-400 font-mono text-xs">{step}</div>
                <div>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Three entry paths */}
        <div className="space-y-4">
          <p className="text-center text-slate-400 text-sm font-medium uppercase tracking-wider">
            Выберите ваш путь
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {ENTRY_PATHS.map((path) => (
              <div
                key={path.title}
                className="relative bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 hover:border-white/20 transition-all group"
              >
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{path.icon}</span>
                  <span className="text-xs text-slate-400 border border-white/10 rounded-full px-2.5 py-1">
                    {path.badge}
                  </span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">{path.title}</h3>
                  <p className="text-slate-400 text-sm mt-1 leading-relaxed">{path.desc}</p>
                </div>
                <Link
                  href={path.href}
                  className={`block w-full text-center bg-gradient-to-r ${path.accent} hover:opacity-90 text-white text-sm font-semibold px-4 py-3 rounded-xl transition-opacity`}
                >
                  {path.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Niches */}
        <div className="space-y-4">
          <p className="text-center text-slate-400 text-sm font-medium uppercase tracking-wider">
            Работаем со всеми нишами
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {NICHES.map((niche) => (
              <span
                key={niche}
                className="bg-white/5 border border-white/10 text-slate-300 text-sm px-3 py-1.5 rounded-full"
              >
                {niche}
              </span>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10" />

        {/* Balance Dashboard */}
        {user && <BalanceDashboard />}

      </div>
    </main>
  );
}
