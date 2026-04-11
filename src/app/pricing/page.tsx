"use client";

import Link from "next/link";
import { useState } from "react";

const CHECK = (
  <svg className="w-4 h-4 text-green-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const CROSS = (
  <svg className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

type Feature = { label: string; included: boolean };

interface Plan {
  id: string;
  name: string;
  price: number | null;
  priceLabel?: string;
  description: string;
  popular: boolean;
  cta: string;
  features: Feature[];
}

const plans: Plan[] = [
  {
    id: "start",
    name: "Старт",
    price: 0,
    priceLabel: "Бесплатно",
    description: "Попробуй без риска",
    popular: false,
    cta: "Начать бесплатно",
    features: [
      { label: "2 ролика в месяц", included: true },
      { label: "До 30 секунд", included: true },
      { label: "Groq AI сценарий", included: true },
      { label: "Flux кадры", included: true },
      { label: "Формат 9:16", included: true },
      { label: "Watermark на видео", included: false },
      { label: "Claude сценарий", included: false },
      { label: "ElevenLabs войсовер", included: false },
      { label: "MidJourney кадры", included: false },
      { label: "Клонирование голоса", included: false },
      { label: "API доступ", included: false },
      { label: "White Label", included: false },
    ],
  },
  {
    id: "pro",
    name: "Про",
    price: 2990,
    description: "Для активного контента",
    popular: true,
    cta: "Выбрать тариф",
    features: [
      { label: "15 роликов в месяц", included: true },
      { label: "До 45 секунд", included: true },
      { label: "Claude Sonnet сценарий", included: true },
      { label: "Flux + Recraft кадры", included: true },
      { label: "Форматы 9:16 + 1:1", included: true },
      { label: "Без watermark", included: true },
      { label: "ElevenLabs войсовер", included: true },
      { label: "MidJourney v7 герои", included: true },
      { label: "Клонирование голоса", included: false },
      { label: "Mubert саундтрек", included: false },
      { label: "API доступ", included: false },
      { label: "White Label", included: false },
    ],
  },
  {
    id: "profi",
    name: "Профи",
    price: 9990,
    description: "Для брендов с серьёзным контентом",
    popular: false,
    cta: "Выбрать тариф",
    features: [
      { label: "50 роликов в месяц", included: true },
      { label: "До 60 секунд", included: true },
      { label: "Claude Opus × 5 итераций", included: true },
      { label: "MidJourney v7 кадры", included: true },
      { label: "Все форматы экспорта", included: true },
      { label: "Без watermark", included: true },
      { label: "ElevenLabs + клон голоса", included: true },
      { label: "Mubert оригинал. саундтрек", included: true },
      { label: "LUT цветокоррекция", included: true },
      { label: "Анализ конкурентов", included: false },
      { label: "API доступ", included: false },
      { label: "White Label", included: false },
    ],
  },
  {
    id: "studio",
    name: "Студия",
    price: 29990,
    description: "Для агентств и крупных брендов",
    popular: false,
    cta: "Выбрать тариф",
    features: [
      { label: "Безлимитные ролики", included: true },
      { label: "До 90 секунд", included: true },
      { label: "Claude Opus + анализ конк.", included: true },
      { label: "MidJourney v7 + 3D модель", included: true },
      { label: "Все форматы экспорта", included: true },
      { label: "Без watermark", included: true },
      { label: "Клонирование голоса бренда", included: true },
      { label: "Mubert + Topaz 4K апскейл", included: true },
      { label: "LUT цветокоррекция", included: true },
      { label: "White Label", included: true },
      { label: "API доступ", included: true },
      { label: "Несколько брендов", included: true },
    ],
  },
];

const faqs = [
  {
    q: "Можно ли сменить тариф?",
    a: "Да, в любой момент. При апгрейде — разница пересчитывается пропорционально. При даунгрейде — новый тариф активируется со следующего периода.",
  },
  {
    q: "Что считается «роликом»?",
    a: "Один ролик — одна готовая видеозапись с монтажом. Промежуточные генерации кадров и черновые варианты не считаются.",
  },
  {
    q: "Есть ли возврат средств?",
    a: "Да, в течение 7 дней с момента оплаты, если вы ещё не использовали ролики тарифа. Напишите в поддержку — вернём без вопросов.",
  },
  {
    q: "Что такое White Label?",
    a: "Режим, при котором в финальном видео нет упоминаний AI Video Factory. Ролик выглядит как произведённый полностью внутри вашей компании.",
  },
];

function formatPrice(price: number, annual: boolean): string {
  const p = annual ? Math.round(price * 0.8) : price;
  return p.toLocaleString("ru-RU");
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-16">

        {/* Back link */}
        <div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Создать ролик
          </Link>
        </div>

        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Выбери тариф
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            От первого теста до полноценного брендового производства — найди подходящий план
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-3 bg-slate-900 border border-white/10 rounded-xl p-1 mt-2">
            <button
              onClick={() => setAnnual(false)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                !annual
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Месяц
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                annual
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Год
              <span className="bg-green-500/20 text-green-400 text-xs px-1.5 py-0.5 rounded-md font-semibold">
                −20%
              </span>
            </button>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                plan.popular
                  ? "border-purple-500 bg-purple-950/30 shadow-lg shadow-purple-900/30"
                  : "border-white/10 bg-slate-900/50 hover:border-white/20"
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow">
                    Популярный
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="space-y-2 mb-6">
                <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                <p className="text-slate-500 text-xs">{plan.description}</p>

                <div className="pt-1">
                  {plan.price === 0 ? (
                    <div className="text-3xl font-bold text-white">Бесплатно</div>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-bold text-white">
                        {formatPrice(plan.price!, annual)}
                      </span>
                      <span className="text-slate-400 text-sm mb-1">₽/мес</span>
                    </div>
                  )}
                  {annual && plan.price !== null && plan.price > 0 && (
                    <p className="text-green-400 text-xs mt-1">
                      {formatPrice(plan.price * 0.8 * 12, false)} ₽ в год
                    </p>
                  )}
                </div>
              </div>

              {/* CTA */}
              <Link
                href="/create"
                className={`w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-all mb-6 ${
                  plan.popular
                    ? "bg-purple-600 hover:bg-purple-500 text-white"
                    : plan.price === 0
                    ? "bg-white/10 hover:bg-white/15 text-white"
                    : "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
                }`}
              >
                {plan.cta}
              </Link>

              {/* Features */}
              <ul className="space-y-2.5 flex-1">
                {plan.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {feat.included ? CHECK : CROSS}
                    <span
                      className={`text-sm leading-snug ${
                        feat.included ? "text-slate-200" : "text-slate-600"
                      }`}
                    >
                      {feat.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto space-y-3">
          <h2 className="text-2xl font-bold text-center mb-8">Частые вопросы</h2>
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="border border-white/10 rounded-xl overflow-hidden bg-slate-900/50"
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left text-sm font-medium text-white hover:bg-white/5 transition-colors"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span>{faq.q}</span>
                <svg
                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                    openFaq === i ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {openFaq === i && (
                <div className="px-5 pb-4 text-sm text-slate-400 leading-relaxed border-t border-white/5 pt-3">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-slate-600 text-xs pb-4">
          Все цены указаны в рублях. Оплата через ЮKassa. При возникновении вопросов — напишите в поддержку.
        </p>

      </div>
    </main>
  );
}
