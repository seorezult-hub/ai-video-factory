/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect } from "react";
import { ProjectData } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

type FrameState = {
  index: number;
  sceneNumber: number;
  status: "pending" | "generating" | "done" | "error";
  variants: string[];
};

const FRAME_TIME_S = 20;

export function StepFrames({ data, onUpdate, onNext, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FrameState[]>([]);
  const [variantsPerScene, setVariantsPerScene] = useState<1 | 2 | 3>(1);
  const [regenFrame, setRegenFrame] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const totalScenes = data.script?.length ?? 0;
  const batchSize = 3;
  const estimatedSecs = Math.ceil(totalScenes / batchSize) * FRAME_TIME_S * variantsPerScene;

  const selectVariant = (sceneIdx: number, url: string) => {
    const newKeyframes = [...data.keyframes];
    while (newKeyframes.length <= sceneIdx) newKeyframes.push("");
    newKeyframes[sceneIdx] = url;
    onUpdate({ keyframes: newKeyframes });
  };

  const generateFrames = async () => {
    if (!data.script) return;
    setLoading(true);
    setError(null);
    onUpdate({ keyframes: [], keyframeVariants: [], selectedFrames: [] });

    const initial: FrameState[] = data.script.map((s, i) => ({
      index: i,
      sceneNumber: s.sceneNumber,
      status: "pending",
      variants: [],
    }));
    setFrames(initial);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeoutId = setTimeout(() => ctrl.abort(), 8 * 60 * 1000);

    try {
      const res = await fetch("/api/generate/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: data.script,
          brandName: data.brandName,
          mood: data.mood,
          uploadedImages: data.uploadedImages,
          variantsPerScene,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error("Сервер вернул ошибку");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              index?: number;
              sceneNumber?: number;
              url?: string;
              variants?: string[];
              keyframes?: string[];
              keyframeVariants?: string[][];
              valid?: number;
              error?: string;
            };

            if (event.type === "generating" && event.index !== undefined) {
              setFrames((prev) =>
                prev.map((f) => f.index === event.index ? { ...f, status: "generating" } : f)
              );
            } else if (event.type === "frame_done" && event.index !== undefined) {
              const variants = event.variants ?? (event.url ? [event.url] : []);
              setFrames((prev) =>
                prev.map((f) => f.index === event.index ? { ...f, status: "done", variants } : f)
              );
            } else if (event.type === "frame_error" && event.index !== undefined) {
              setFrames((prev) =>
                prev.map((f) => f.index === event.index ? { ...f, status: "error" } : f)
              );
            } else if (event.type === "done" && event.keyframes) {
              onUpdate({
                keyframes: event.keyframes,
                keyframeVariants: event.keyframeVariants ?? event.keyframes.map((u) => u ? [u] : []),
                selectedFrames: event.keyframes.map((u, i) => (u ? i : -1)).filter((i) => i >= 0),
              });
            } else if (event.type === "error") {
              throw new Error(event.error ?? "Ошибка генерации");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Превышено время ожидания. Попробуй снова.");
      } else {
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setLoading(false);
    }
  };

  const regenSingleFrame = async (sceneIdx: number) => {
    if (!data.script?.[sceneIdx]) return;
    setRegenFrame(sceneIdx);

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 2 * 60 * 1000);

    try {
      const res = await fetch("/api/generate/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: [data.script[sceneIdx]],
          brandName: data.brandName,
          mood: data.mood,
          uploadedImages: data.uploadedImages,
          variantsPerScene,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error("Сервер вернул ошибку");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              index?: number;
              variants?: string[];
              url?: string;
              keyframes?: string[];
              keyframeVariants?: string[][];
            };

            if (event.type === "done" && event.keyframes) {
              const newUrl = event.keyframes[0] ?? "";
              const newVariants = event.keyframeVariants?.[0] ?? (newUrl ? [newUrl] : []);

              const updatedKeyframes = [...(data.keyframes ?? [])];
              while (updatedKeyframes.length <= sceneIdx) updatedKeyframes.push("");
              updatedKeyframes[sceneIdx] = newUrl;

              const updatedVariants = [...(data.keyframeVariants ?? [])];
              while (updatedVariants.length <= sceneIdx) updatedVariants.push([]);
              updatedVariants[sceneIdx] = newVariants;

              onUpdate({ keyframes: updatedKeyframes, keyframeVariants: updatedVariants });
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Превышено время ожидания. Попробуй снова.");
      } else {
        setError(e instanceof Error ? e.message : "Ошибка перегенерации");
      }
    } finally {
      clearTimeout(timeoutId);
      setRegenFrame(null);
    }
  };

  const toggleScene = (index: number) => {
    const selected = data.selectedFrames.includes(index)
      ? data.selectedFrames.filter((i) => i !== index)
      : [...data.selectedFrames, index];
    onUpdate({ selectedFrames: selected });
  };

  const doneCount = frames.filter((f) => f.status === "done").length;
  const errorCount = frames.filter((f) => f.status === "error").length;
  const progress = totalScenes > 0 ? Math.round((doneCount / totalScenes) * 100) : 0;

  const hasVariants = data.keyframeVariants?.some((v) => v.length > 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Ключевые кадры</h2>
        <p className="text-slate-400">
          {data.keyframes.length > 0
            ? `${data.keyframes.filter(Boolean).length} кадров готово${hasVariants ? " — выбери лучший вариант для каждой сцены" : ""}`
            : "AI генерирует изображение для каждой сцены"}
        </p>
      </div>

      {/* Старт */}
      {frames.length === 0 && !loading && data.keyframes.length === 0 && (
        <div className="space-y-4">
          {/* Выбор количества вариантов */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300 font-medium">Вариантов на сцену</span>
              <span className="text-xs text-slate-500">
                {variantsPerScene === 1 ? "Быстро" : variantsPerScene === 2 ? "Рекомендуется" : "Максимум выбора"}
              </span>
            </div>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setVariantsPerScene(n)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                    variantsPerScene === n
                      ? "border-purple-500 bg-purple-500/10 text-white"
                      : "border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  {n} {n === 1 ? "вариант" : n === 2 ? "варианта" : "варианта"}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500 space-y-0.5">
              <p>· {totalScenes} сцен × {variantsPerScene} = {totalScenes * variantsPerScene} кадров</p>
              <p>· Примерное время: ~{estimatedSecs} сек</p>
              {variantsPerScene > 1 && (
                <p className="text-purple-400">· Выберешь лучший кадр для каждой сцены — как у Егора Кузьмина</p>
              )}
            </div>
          </div>

          <button
            onClick={generateFrames}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            Генерировать кадры
          </button>
        </div>
      )}

      {/* Прогресс генерации */}
      {loading && frames.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Готово: {doneCount} / {totalScenes}</span>
              <span className="flex items-center gap-2 text-slate-400">
                <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                Генерирую {variantsPerScene > 1 ? `по ${variantsPerScene} варианта` : ""}...
              </span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {frames.map((frame) => (
              <div key={frame.index} className="aspect-[9/16] relative rounded-xl overflow-hidden bg-white/5 border border-white/10">
                {frame.status === "done" && frame.variants[0] ? (
                  <img src={frame.variants[0]} alt={`Сцена ${frame.sceneNumber}`} className="absolute inset-0 w-full h-full object-cover" />
                ) : frame.status === "generating" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-400">Сцена {frame.sceneNumber}</span>
                  </div>
                ) : frame.status === "error" ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-red-400 text-xs">Ошибка</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-slate-600 text-xs">Сцена {frame.sceneNumber}</span>
                  </div>
                )}
                {frame.status === "done" && (
                  <div className="absolute top-2 left-2 bg-green-500/80 text-white text-xs px-2 py-0.5 rounded">
                    {frame.variants.length > 1 ? `${frame.variants.length} вар.` : "✓"}
                  </div>
                )}
              </div>
            ))}
          </div>

          {errorCount > 0 && (
            <p className="text-sm text-yellow-400">{errorCount} кадр не удался — будут пропущены</p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={generateFrames} className="ml-3 underline">Повторить</button>
        </div>
      )}

      {/* Результат — варианты + выбор */}
      {data.keyframes.length > 0 && !loading && (
        <>
          {hasVariants && (
            <div className="bg-purple-900/20 border border-purple-500/20 rounded-xl p-3 text-sm text-slate-300">
              <span className="text-purple-300 font-medium">Выбери лучший вариант</span> для каждой сцены.
              Нажми на кадр чтобы выбрать — он пойдёт в генерацию видео.
            </div>
          )}

          <div className="space-y-6">
            {(data.script ?? []).map((scene, sceneIdx) => {
              const variants = data.keyframeVariants?.[sceneIdx] ?? (data.keyframes[sceneIdx] ? [data.keyframes[sceneIdx]] : []);
              const selectedUrl = data.keyframes[sceneIdx] ?? "";
              const sceneSelected = data.selectedFrames.includes(sceneIdx);

              if (variants.length === 0) return null;

              return (
                <div key={sceneIdx} className="space-y-2">
                  {/* Заголовок сцены */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-medium text-slate-300">
                      Сцена {scene.sceneNumber} · {scene.duration}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => regenSingleFrame(sceneIdx)}
                        disabled={regenFrame !== null || loading}
                        className="text-xs px-3 py-1 rounded-full border border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300 disabled:opacity-30 transition-all"
                      >
                        {regenFrame === sceneIdx ? (
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                            Генерирую...
                          </span>
                        ) : "Перегенерировать"}
                      </button>
                      <button
                        onClick={() => toggleScene(sceneIdx)}
                        className={`text-xs px-3 py-1 rounded-full border transition-all ${
                          sceneSelected
                            ? "border-purple-500 bg-purple-500/20 text-purple-300"
                            : "border-white/10 text-slate-500 hover:border-white/20"
                        }`}
                      >
                        {sceneSelected ? "✓ В ролик" : "Добавить в ролик"}
                      </button>
                    </div>
                  </div>

                  {/* Варианты кадров */}
                  <div className={`grid gap-3 ${variants.length === 1 ? "grid-cols-1" : variants.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                    {regenFrame === sceneIdx && (
                      <div className="col-span-full aspect-[9/16] rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-slate-400">Генерирую кадр...</span>
                        </div>
                      </div>
                    )}
                    {regenFrame !== sceneIdx && variants.map((url, vi) => {
                      const isSelected = url === selectedUrl;
                      return (
                        <button
                          key={url}
                          onClick={() => selectVariant(sceneIdx, url)}
                          className={`relative aspect-[9/16] rounded-xl overflow-hidden border-2 transition-all ${
                            isSelected
                              ? "border-purple-500 ring-2 ring-purple-500/30"
                              : "border-white/10 opacity-70 hover:opacity-90 hover:border-white/25"
                          }`}
                        >
                          <img src={url} alt={`Вариант ${vi + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                            {variants.length > 1 ? `Вариант ${vi + 1}` : `Сцена ${scene.sceneNumber}`}
                          </div>
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                              ✓
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                </div>
              );
            })}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              ← Назад
            </button>
            <button
              onClick={onNext}
              disabled={data.selectedFrames.length === 0}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Генерировать видео ({data.selectedFrames.length} сцен) →
            </button>
          </div>

          <button onClick={generateFrames} className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors">
            Перегенерировать все кадры
          </button>
        </>
      )}
    </div>
  );
}
