"use client";

import { useState, useRef, useEffect } from "react";

type Props = {
  brandName: string;
  mood: string;
  productDescription: string;
  videoType?: string;
  heroImageUrl: string;      // @Image1 — face/body photo already uploaded
  onSelect: (url: string) => void;  // called with chosen collage URL
  onClose: () => void;
};

type Stage = "idle" | "generating" | "selecting" | "error";

export function HeroCollageModal({
  brandName,
  mood,
  productDescription,
  videoType,
  heroImageUrl,
  onSelect,
  onClose,
}: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [variants, setVariants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const generate = async () => {
    setStage("generating");
    setError(null);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch("/api/generate/hero-collage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heroImageUrl, brandName, mood, productDescription, videoType }),
        signal: ctrl.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка генерации");
      }

      if (!data.variants || data.variants.length === 0) {
        throw new Error("Варианты не получены");
      }

      setVariants(data.variants);
      setStage("selecting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      setStage("error");
    }
  };

  const confirmSelection = () => {
    if (selected === null) return;
    onSelect(variants[selected]);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold">Коллаж героя — Midjourney v7</h3>
            <p className="text-sm text-slate-400 mt-0.5">
              --cref сохраняет лицо героя во всех сценах
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Idle state — explain & start */}
          {stage === "idle" && (
            <div className="space-y-4">
              <div className="bg-purple-900/20 border border-purple-500/20 rounded-xl p-4 text-sm text-slate-300 space-y-2">
                <p>
                  <span className="text-purple-300 font-medium">Зачем нужен коллаж?</span>
                  {" "}Seedance 2.0 использует @Image1 как референс героя. Без коллажа лицо меняется от сцены к сцене.
                </p>
                <p>
                  Midjourney v7 c флагом <code className="bg-white/10 px-1 rounded">--cref</code> создаёт
                  {" "}4 варианта героя в стиле бренда — выбери лучший и он заменит @Image1.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={heroImageUrl}
                  alt="Исходное фото героя"
                  className="w-16 h-16 object-cover rounded-lg border border-white/20 flex-shrink-0"
                />
                <div className="text-sm">
                  <p className="text-slate-300 font-medium">Исходное фото @Image1</p>
                  <p className="text-slate-500 text-xs mt-1">Будет использовано как --cref для Midjourney</p>
                </div>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>· Стиль: {mood || "по умолчанию"}</p>
                <p>· Формат: 9:16 вертикальный</p>
                <p>· Модель: Midjourney v7 --style raw</p>
                <p>· Время: ~45–90 сек</p>
                <p>· Стоимость: ~$0.04</p>
              </div>

              <button
                onClick={generate}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Создать 4 варианта героя
              </button>
            </div>
          )}

          {/* Generating */}
          {stage === "generating" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-300 font-medium">Midjourney v7 генерирует коллаж...</p>
              <p className="text-slate-500 text-sm">Обычно 45–90 секунд. Не закрывай окно.</p>
            </div>
          )}

          {/* Select variant */}
          {stage === "selecting" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Выбери лучший вариант — он заменит @Image1 и сохранит лицо героя во всех сценах
              </p>

              <div className="grid grid-cols-2 gap-3">
                {variants.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setSelected(i)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-[9/16] ${
                      selected === i
                        ? "border-purple-500 ring-2 ring-purple-500/40"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Вариант ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {selected === i && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        ✓
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                      Вариант {i + 1}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={generate}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 font-medium py-3 rounded-xl transition-colors text-sm"
                >
                  Перегенерировать
                </button>
                <button
                  onClick={confirmSelection}
                  disabled={selected === null}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Выбрать этот вариант
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {stage === "error" && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
                {error}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 font-medium py-3 rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={generate}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Попробовать снова
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
