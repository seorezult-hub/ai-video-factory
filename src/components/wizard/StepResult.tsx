"use client";

import { useState, useRef, useEffect } from "react";
import { ProjectData } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onPrev: () => void;
};

type AssembleStage = {
  stage: string;
  label: string;
  current?: number;
  total?: number;
};

const STAGE_ORDER = ["n8n", "fallback", "downloading", "encoding", "audio", "uploading"];

function stageProgress(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return 10;
  return Math.round(((idx + 1) / STAGE_ORDER.length) * 90) + 10;
}

async function readSSEStream(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {}
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function generateSRT(
  script: Array<{ sceneNumber: number; description?: string; descriptionRu?: string; duration?: string }>,
  brandName: string
): string {
  let srt = "";
  let currentTime = 0;
  for (let i = 0; i < script.length; i++) {
    const scene = script[i];
    const durationSec = parseInt(scene.duration ?? "5") || 5;
    const start = formatSRTTime(currentTime);
    const end = formatSRTTime(currentTime + durationSec - 0.2);
    const text = scene.descriptionRu ?? scene.description ?? `Сцена ${scene.sceneNumber}`;
    srt += `${i + 1}\n${start} --> ${end}\n${text}\n\n`;
    currentTime += durationSec;
  }
  void brandName;
  return srt.trim();
}

type SceneType = "nature" | "product" | "face" | "action" | "logo" | "unknown";

// Инферить тип сцены из текстового описания (fallback если AI не вернул sceneType)
function inferSceneType(text: string): SceneType {
  const t = text.toLowerCase();
  if (/logo|логотип|бренд.*знак|brand mark|title card/.test(t)) return "logo";
  if (/product|флакон|bottle|packaging|упаковк|object detail|продукт/.test(t)) return "product";
  if (/face|portrait|close-up.*person|лицо|глаза|eyes|skin|кожа|hands|руки/.test(t)) return "face";
  if (/action|run|crowd|толп|energy|dynamic|explosive|fast/.test(t)) return "action";
  if (/nature|landscape|sky|ocean|desert|forest|небо|пустын|лес|природ|море/.test(t)) return "nature";
  return "unknown";
}

// Стоимость оригинала (для расчёта платной перегенерации)
const DURATION_COST: Record<string, number> = {
  "15-single": 0.17,
  "15-30": 0.45,
  "30-45": 0.75,
  "45-60": 1.05,
};

type ExportState = "idle" | "loading" | "done" | "error";
type ExportFormat = { id: "1:1" | "16:9" | "4:5"; label: string; sub: string; platforms: string; free: boolean };

const FREE_FORMATS: ExportFormat[] = [
  { id: "1:1",  label: "1:1 Квадрат",    sub: "Instagram лента, Telegram",     platforms: "Instagram · Telegram · VK",  free: true },
  { id: "4:5",  label: "4:5 Портрет",    sub: "Instagram лента (максимум охват)", platforms: "Instagram Feed",             free: true },
  { id: "16:9", label: "16:9 Горизонталь", sub: "YouTube, blur-фон по бокам",  platforms: "YouTube · VK Video · Сайт",  free: true },
];

export function StepResult({ data, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [currentStage, setCurrentStage] = useState<AssembleStage | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(data.burnSubtitles ?? false);
  const [exportStates, setExportStates] = useState<Record<string, ExportState>>({});
  const [exportUrls, setExportUrls] = useState<Record<string, string>>({});
  const [exportErrors, setExportErrors] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleDownload = async () => {
    if (!finalVideoUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(finalVideoUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${data.brandName || "video"}-promo.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // CORS fallback — открываем в новой вкладке
      window.open(finalVideoUrl, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  const exportFormat = async (fmt: ExportFormat) => {
    if (!finalVideoUrl) return;
    setExportStates((s) => ({ ...s, [fmt.id]: "loading" }));
    setExportErrors((e) => ({ ...e, [fmt.id]: "" }));
    try {
      const res = await fetch("/api/generate/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: finalVideoUrl,
          targetFormat: fmt.id,
          sourceFormat: data.aspectRatio ?? "9:16",
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Ошибка экспорта");
      setExportUrls((u) => ({ ...u, [fmt.id]: result.url }));
      setExportStates((s) => ({ ...s, [fmt.id]: "done" }));
    } catch (e) {
      setExportStates((s) => ({ ...s, [fmt.id]: "error" }));
      setExportErrors((err) => ({ ...err, [fmt.id]: e instanceof Error ? e.message : "Ошибка" }));
    }
  };

  const downloadExport = async (url: string, format: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${data.brandName || "video"}-${format.replace(":", "x")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const originalCost = DURATION_COST[data.videoDuration] ?? 0.75;
  const selectedClipUrls = data.selectedClips.map((i) => data.videoClips[i]);

  const assemble = async () => {
    setLoading(true);
    setError(null);
    setCurrentStage(null);
    setProgressPct(5);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeoutId = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);

    try {
      // Извлекаем типы сцен из скрипта (по выбранным клипам)
      const sceneTypes = data.selectedClips.map((clipIdx) => {
        const scene = data.script?.[clipIdx];
        return (scene?.sceneType ?? inferSceneType(scene?.descriptionRu ?? scene?.description ?? "")) as SceneType;
      });

      const res = await fetch("/api/generate/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: selectedClipUrls,
          musicUrl: data.musicUrl,
          voiceoverUrl: data.voiceoverUrl ?? null,
          brandName: data.brandName,
          aspectRatio: data.aspectRatio ?? "9:16",
          mood: data.mood || "Люкс",
          sceneTypes,
          subtitles: burnSubtitles,
          subtitleScript: burnSubtitles && data.script ? data.script : undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error("Сервер вернул ошибку");

      let resultUrl: string | null = null;
      let assembleError: string | null = null;

      await readSSEStream(res, (event) => {
        if (event.type === "stage") {
          setCurrentStage({
            stage: event.stage as string,
            label: event.label as string,
            current: event.current as number | undefined,
            total: event.total as number | undefined,
          });
          setProgressPct(stageProgress(event.stage as string));
        } else if (event.type === "clip_error") {
          console.warn("[assemble] clip error:", event.label);
        } else if (event.type === "done" && event.videoUrl) {
          resultUrl = event.videoUrl as string;
          setProgressPct(100);
          setFinalVideoUrl(resultUrl);
        } else if (event.type === "error") {
          assembleError = (event.error as string) ?? "Ошибка сборки";
        }
      });

      if (assembleError) throw new Error(assembleError);

      if (!resultUrl) {
        throw new Error("Сборка завершилась без результата. Попробуй снова.");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Превышено время сборки (5 мин). Попробуй снова.");
      } else {
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Финальный ролик</h2>
        <p className="text-slate-400">
          {data.selectedClips.length} сцен · {data.brandName}
        </p>
      </div>

      {!finalVideoUrl && !loading && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-1">
            <p>· {data.selectedClips.length} клипа будут склеены</p>
            {data.musicUrl && <p>· Добавляется фоновая музыка</p>}
            <p>· Формат: {data.aspectRatio ?? "9:16"} {(data.aspectRatio ?? "9:16") === "9:16" ? "вертикальный" : "горизонтальный"}</p>
            <p>· Примерное время: 1–3 мин</p>
          </div>
          {data.script && data.script.length > 0 && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setBurnSubtitles((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${burnSubtitles ? "bg-purple-600" : "bg-white/10"}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${burnSubtitles ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </div>
              <span className="text-sm text-slate-300">Вжечь субтитры в видео</span>
            </label>
          )}
          <button
            onClick={assemble}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            Собрать финальное видео
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-6 py-4">
          {/* Прогресс-бар */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">{currentStage?.label ?? "Подготовка..."}</span>
              <span className="text-slate-500">{progressPct}%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Этапы */}
          <div className="space-y-2">
            {[
              { id: "downloading", label: "Скачиваю клипы" },
              { id: "encoding", label: "FFmpeg: склеиваю" },
              { id: "audio", label: "Добавляю музыку" },
              { id: "uploading", label: "Загружаю в облако" },
            ].map((s) => {
              const stageIdx = STAGE_ORDER.indexOf(s.id);
              const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage.stage) : -1;
              const isDone = currentIdx > stageIdx;
              const isActive = currentIdx === stageIdx;

              return (
                <div key={s.id} className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                      isDone
                        ? "bg-green-500 text-white"
                        : isActive
                        ? "border-2 border-purple-500 text-purple-400"
                        : "border-2 border-white/10 text-transparent"
                    }`}
                  >
                    {isDone ? "✓" : isActive ? (
                      <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                    ) : ""}
                  </div>
                  <span
                    className={`text-sm ${
                      isDone ? "text-slate-400 line-through" : isActive ? "text-white" : "text-slate-600"
                    }`}
                  >
                    {s.label}
                    {isActive && currentStage?.current && currentStage?.total && (
                      <span className="text-slate-400 ml-2">
                        {currentStage.current}/{currentStage.total}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
            Не закрывай вкладку...
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={assemble} className="ml-3 underline">Повторить</button>
        </div>
      )}

      {finalVideoUrl && (
        <div className="space-y-6">
          <video
            src={finalVideoUrl}
            controls
            autoPlay
            playsInline
            onError={() => setVideoError(true)}
            className={`w-full mx-auto rounded-2xl bg-black ${
              (data.aspectRatio ?? "9:16") === "9:16"
                ? "max-w-sm aspect-[9/16]"
                : "max-w-2xl aspect-video"
            }`}
          />
          {videoError && (
            <div className="text-center text-sm text-slate-400">
              Видео не воспроизводится в браузере.{" "}
              <button
                onClick={() => window.open(finalVideoUrl, "_blank")}
                className="text-purple-400 underline"
              >
                Открыть напрямую
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-center transition-colors"
            >
              {downloading ? "Скачиваю..." : "Скачать MP4"}
            </button>
            {data.script && data.script.length > 0 && (
              <button
                onClick={() => {
                  const srt = generateSRT(data.script!, data.brandName ?? "");
                  const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${data.brandName ?? "subtitles"}.srt`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium py-3 px-4 rounded-xl transition-colors"
              >
                Субтитры SRT
              </button>
            )}
            <button
              onClick={() => (window.location.href = "/create")}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Создать ещё
            </button>
          </div>

          {/* Скачать отдельные клипы для ручного монтажа */}
          {selectedClipUrls.length > 0 && (
            <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Клипы для ручного монтажа</p>
                <p className="text-xs text-slate-500 mt-0.5">Скачай каждый клип отдельно → открой в CapCut / DaVinci Resolve</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {selectedClipUrls.map((url, i) => (
                  <a
                    key={`clip-dl-${i}`}
                    href={url}
                    download={`${data.brandName ?? "clip"}-scene${i + 1}.mp4`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-800/60 hover:bg-slate-700/60 border border-white/8 rounded-lg px-3 py-2 transition-colors group"
                  >
                    <span className="text-slate-300 text-sm">Сцена {i + 1}</span>
                    <span className="text-slate-500 group-hover:text-slate-300 text-xs transition-colors">Скачать →</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Экспорт в другие форматы */}
          <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5">
              <p className="text-sm font-semibold text-slate-200">Экспорт под другие платформы</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Основной формат: <span className="text-white">{data.aspectRatio ?? "9:16"}</span>
                {data.platform && <span className="ml-2 text-purple-400">· {data.platform}</span>}
              </p>
            </div>

            <div className="p-4 space-y-3">
              {/* Бесплатные форматы — FFmpeg */}
              {FREE_FORMATS.map((fmt) => {
                const state = exportStates[fmt.id] ?? "idle";
                const url = exportUrls[fmt.id];
                const errMsg = exportErrors[fmt.id];
                const isCurrentFormat = fmt.id === data.aspectRatio;

                if (isCurrentFormat) return null;

                return (
                  <div key={fmt.id} className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">{fmt.label}</span>
                        <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded font-semibold">
                          БЕСПЛАТНО
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{fmt.sub}</p>
                      <p className="text-xs text-slate-600">{fmt.platforms}</p>
                      {errMsg && <p className="text-xs text-red-400 mt-1">{errMsg}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {state === "done" && url ? (
                        <button
                          onClick={() => downloadExport(url, fmt.id)}
                          className="text-xs bg-green-600/30 hover:bg-green-600/50 border border-green-500/30 text-green-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Скачать
                        </button>
                      ) : state === "loading" ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                          ~30 сек
                        </div>
                      ) : (
                        <button
                          onClick={() => exportFormat(fmt)}
                          className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Конвертировать
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Платная перегенерация */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white font-medium">
                        Перегенерация в {data.aspectRatio === "9:16" ? "16:9 YouTube" : "9:16 Vertical"}
                      </span>
                      <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-semibold">
                        ${originalCost.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Seedance 2.0 заново генерирует все сцены в нативном формате {data.aspectRatio === "9:16" ? "16:9" : "9:16"} — лучшая композиция, правильные пропорции кадра
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Стоимость = {data.selectedClips.length} сцен × ${(originalCost / Math.max(data.selectedClips.length, 1)).toFixed(2)} = ${originalCost.toFixed(2)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => (window.location.href = "/create")}
                  className="text-xs bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Создать в {data.aspectRatio === "9:16" ? "16:9" : "9:16"} →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!finalVideoUrl && !loading && (
        <button
          onClick={onPrev}
          className="w-full bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
        >
          ← Назад к клипам
        </button>
      )}
    </div>
  );
}
