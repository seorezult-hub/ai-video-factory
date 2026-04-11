"use client";

import { useEffect, useState } from "react";

type ServiceBalance = {
  service: string;
  label: string;
  balance: number | null;
  currency: string;
  unit: string;
  status: "ok" | "low" | "empty" | "unknown" | "error";
  topupUrl: string;
  videosRemaining: number | null;
  costPerVideo: number | null;
  error?: string;
};

const SERVICE_ICONS: Record<string, string> = {
  fal: "⚡",
  atlas: "🎬",
  piapi: "🎨",
  elevenlabs: "🎙️",
  groq: "🧠",
  gemini: "✨",
};

const SERVICE_DESC: Record<string, string> = {
  fal: "Flux · Recraft · Upscale",
  atlas: "Seedance 2.0 · 10 сек/клип · $0.022/сек",
  piapi: "Midjourney v7 · Герои",
  elevenlabs: "TTS · Войсовер",
  groq: "Llama · Сценарии · бесплатно",
  gemini: "Vision · Анализ · бесплатно",
};

const VIDEO_COST_DESC: Record<string, string> = {
  atlas: "$1.10 / ролик (5 клипов × 10 сек)",
  fal: "$0.025 / ролик (5 кадров)",
  piapi: "$0.08 / ролик (герой MJ v7)",
  elevenlabs: "1200 симв. / ролик (~50 сек)",
};

const STATUS_CONFIG = {
  ok:      { color: "text-emerald-400", bg: "bg-emerald-500/10",  border: "border-emerald-500/20",  dot: "bg-emerald-400", label: "Ок" },
  low:     { color: "text-yellow-400",  bg: "bg-yellow-500/10",   border: "border-yellow-500/20",   dot: "bg-yellow-400",  label: "Мало" },
  empty:   { color: "text-red-400",     bg: "bg-red-500/10",      border: "border-red-500/20",      dot: "bg-red-400",     label: "Пустой" },
  unknown: { color: "text-slate-400",   bg: "bg-white/5",         border: "border-white/10",        dot: "bg-slate-500",   label: "Нет ключа" },
  error:   { color: "text-orange-400",  bg: "bg-orange-500/10",   border: "border-orange-500/20",   dot: "bg-orange-400",  label: "Ошибка" },
};

function formatBalance(b: ServiceBalance): string {
  if (b.balance === null) return "—";
  if (b.unit === "симв.") {
    if (b.balance >= 1_000_000) return `${(b.balance / 1_000_000).toFixed(1)}M симв.`;
    if (b.balance >= 1000) return `${(b.balance / 1000).toFixed(0)}K симв.`;
    return `${b.balance} симв.`;
  }
  return `${b.currency}${b.balance.toFixed(2)}`;
}

function SkeletonCard() {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 animate-pulse space-y-3">
      <div className="flex items-start justify-between">
        <div className="w-8 h-8 bg-white/10 rounded-lg" />
        <div className="w-12 h-4 bg-white/10 rounded" />
      </div>
      <div className="space-y-1.5">
        <div className="w-28 h-3 bg-white/10 rounded" />
        <div className="w-20 h-3 bg-white/10 rounded" />
      </div>
      <div className="w-20 h-7 bg-white/10 rounded" />
      <div className="w-full h-8 bg-white/10 rounded-lg" />
    </div>
  );
}

export function BalanceDashboard() {
  const [balances, setBalances] = useState<ServiceBalance[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/balances");
      const data = await res.json();
      setBalances(data.balances);
      setFetchedAt(data.fetchedAt);
    } catch {
      setBalances([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const alerts = balances?.filter((b) => b.status === "low" || b.status === "empty") ?? [];

  // Лимитирующий сервис — тот у кого меньше всего роликов
  const bottleneck = balances
    ?.filter((b) => b.videosRemaining !== null)
    .reduce<ServiceBalance | null>((min, b) => {
      if (min === null) return b;
      return (b.videosRemaining ?? Infinity) < (min.videosRemaining ?? Infinity) ? b : min;
    }, null);

  const totalVideos = bottleneck?.videosRemaining ?? null;

  return (
    <div className="w-full space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-lg">Балансы сервисов</h2>
          {fetchedAt && (
            <p className="text-slate-500 text-xs mt-0.5">
              Обновлено: {new Date(fetchedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
        >
          {loading ? "Загрузка..." : "↻ Обновить"}
        </button>
      </div>

      {/* Итоговый счётчик роликов */}
      {!loading && totalVideos !== null && (
        <div className={`rounded-2xl border px-5 py-4 flex items-center justify-between ${
          totalVideos === 0
            ? "bg-red-500/10 border-red-500/20"
            : totalVideos < 5
            ? "bg-yellow-500/10 border-yellow-500/20"
            : "bg-purple-500/10 border-purple-500/20"
        }`}>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Можно сделать роликов прямо сейчас</p>
            <p className={`text-4xl font-bold font-mono ${
              totalVideos === 0 ? "text-red-400" : totalVideos < 5 ? "text-yellow-400" : "text-white"
            }`}>
              {totalVideos}
              <span className="text-lg font-normal text-slate-400 ml-2">роликов</span>
            </p>
            {bottleneck && (
              <p className="text-xs text-slate-500 mt-1">
                Лимит: {bottleneck.label} ({VIDEO_COST_DESC[bottleneck.service] ?? "—"})
              </p>
            )}
          </div>
          <div className="text-5xl opacity-20">🎬</div>
        </div>
      )}

      {/* Alert banner */}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-lg">⚠️</span>
          <div className="flex-1 text-sm">
            <span className="text-red-300 font-medium">Пополни счёт: </span>
            <span className="text-red-400">{alerts.map((b) => b.label).join(", ")}</span>
          </div>
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : balances?.map((b) => {
              const cfg = STATUS_CONFIG[b.status];
              const icon = SERVICE_ICONS[b.service] ?? "🔌";
              const desc = SERVICE_DESC[b.service] ?? "";
              const isActionable = b.status === "low" || b.status === "empty" || b.status === "unknown";
              const isBottleneck = bottleneck?.service === b.service && b.videosRemaining !== null;

              return (
                <div
                  key={b.service}
                  className={`${cfg.bg} border ${isBottleneck ? "border-orange-400/40 ring-1 ring-orange-400/20" : cfg.border} rounded-2xl p-4 flex flex-col gap-2 transition-all hover:scale-[1.02]`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between">
                    <span className="text-2xl">{icon}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${b.status === "ok" ? "animate-pulse" : ""}`} />
                      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    </div>
                  </div>

                  {/* Name + desc */}
                  <div>
                    <p className="text-white text-sm font-semibold leading-tight">{b.label}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{desc}</p>
                  </div>

                  {/* Balance */}
                  <div className={`text-xl font-bold font-mono ${cfg.color}`}>
                    {formatBalance(b)}
                  </div>

                  {/* Videos remaining */}
                  {b.videosRemaining !== null ? (
                    <div className={`rounded-lg px-3 py-2 text-center ${
                      b.videosRemaining === 0
                        ? "bg-red-500/20"
                        : b.videosRemaining < 5
                        ? "bg-yellow-500/10"
                        : "bg-white/5"
                    }`}>
                      <span className={`text-2xl font-bold font-mono ${
                        b.videosRemaining === 0 ? "text-red-400" : b.videosRemaining < 5 ? "text-yellow-400" : "text-white"
                      }`}>
                        {b.videosRemaining}
                      </span>
                      <span className="text-slate-500 text-xs ml-1.5">роликов</span>
                      {VIDEO_COST_DESC[b.service] && (
                        <p className="text-slate-600 text-xs mt-0.5">{VIDEO_COST_DESC[b.service]}</p>
                      )}
                      {isBottleneck && (
                        <p className="text-orange-400 text-xs mt-0.5 font-medium">⚡ узкое место</p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white/5 rounded-lg px-3 py-2 text-center">
                      <span className="text-slate-500 text-xs">безлимитно</span>
                    </div>
                  )}

                  {/* Topup button */}
                  {isActionable && (
                    <a
                      href={b.topupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-xs text-center py-1.5 px-3 rounded-lg font-medium transition-colors ${
                        b.status === "empty"
                          ? "bg-red-500/30 hover:bg-red-500/50 text-red-300"
                          : b.status === "low"
                          ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300"
                          : "bg-white/10 hover:bg-white/20 text-slate-300"
                      }`}
                    >
                      {b.status === "unknown" ? "Добавить ключ" : "Пополнить →"}
                    </a>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}
