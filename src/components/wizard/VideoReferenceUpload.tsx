"use client";

import { useState, useRef } from "react";
import type { VideoAnalysis } from "@/app/api/analyze/video-reference/route";

type SceneImport = {
  sceneNumber: number;
  duration: string;
  description: string;
  descriptionRu?: string;
  visualPrompt: string;
  cameraMovement: string;
  sceneType: string;
};

type Props = {
  onAnalysis: (analysis: VideoAnalysis, sourceUrl: string) => void;
  onScriptImport?: (scenes: SceneImport[], style: VideoAnalysis, mood: string) => void;
  currentAnalysis: VideoAnalysis | null;
  currentUrl: string;
  brandName?: string;
  niche?: string;
};

type Stage = "idle" | "uploading" | "analyzing" | "done" | "error";

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("youtube.com") || u.hostname === "youtu.be";
  } catch {
    return false;
  }
}

export function VideoReferenceUpload({
  onAnalysis,
  onScriptImport,
  currentAnalysis,
  currentUrl,
  brandName,
  niche,
}: Props) {
  const [stage, setStage] = useState<Stage>(currentAnalysis ? "done" : "idle");
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!!currentAnalysis);
  const [youtubeScenes, setYoutubeScenes] = useState<SceneImport[] | null>(null);
  const [youtubeMood, setYoutubeMood] = useState<string>("");
  const [scriptImported, setScriptImported] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState<"style" | "script">("style");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Анализ через Gemini Vision (для mp4 URL и загруженных файлов)
  const analyzeStyle = async (videoUrl: string) => {
    setStage("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/analyze/video-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка анализа");
      setStage("done");
      onAnalysis(data.analysis as VideoAnalysis, videoUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      setStage("error");
    }
  };

  // Анализ YouTube через Gemini нативный YouTube support
  const analyzeYouTube = async (youtubeUrl: string, mode: "style" | "script") => {
    setStage("analyzing");
    setError(null);
    setYoutubeScenes(null);
    setScriptImported(false);

    try {
      const res = await fetch("/api/analyze/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl,
          context: { brandName, niche },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка анализа YouTube");

      // Сохраняем videoStyle как VideoAnalysis для совместимости
      const styleAsAnalysis: VideoAnalysis = {
        cameraStyle: (data.videoStyle as Record<string, string>).cameraStyle ?? "",
        pacing: (data.videoStyle as Record<string, string>).pacing ?? "",
        editingStyle: (data.videoStyle as Record<string, string>).editingStyle ?? "",
        lightingStyle: (data.videoStyle as Record<string, string>).lightingStyle ?? "",
        colorGrade: (data.videoStyle as Record<string, string>).colorGrade ?? "",
        moodKeywords: (data.videoStyle as Record<string, string[]>).moodKeywords ?? [],
        cameraMovements: (data.videoStyle as Record<string, string[]>).cameraMovements ?? [],
        shotTypes: (data.videoStyle as Record<string, string[]>).shotTypes ?? [],
        recommendations: (data.videoStyle as Record<string, string>).recommendations ?? "",
      };

      onAnalysis(styleAsAnalysis, youtubeUrl);
      setYoutubeScenes(data.scenes ?? null);
      setYoutubeMood(data.suggestedMood ?? "Люкс");
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      setStage("error");
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Нужен видео файл (mp4, mov, etc.)");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError("Максимальный размер файла: 200 МБ");
      return;
    }

    setStage("uploading");
    setError(null);

    try {
      const ext = file.name.split(".").pop() ?? "mp4";
      const key = `video-refs/${crypto.randomUUID()}.${ext}`;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("key", key);

      const uploadRes = await fetch("/api/storage/upload", { method: "POST", body: fd });
      if (!uploadRes.ok) throw new Error("Ошибка загрузки видео");

      const { url } = await uploadRes.json();
      setUrlInput(url);
      await analyzeStyle(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setStage("error");
    }
  };

  const handleAnalyze = () => {
    const url = urlInput.trim();
    if (!url) return;

    if (isYouTubeUrl(url)) {
      analyzeYouTube(url, analyzeMode);
    } else {
      analyzeStyle(url);
    }
  };

  const handleImportScript = () => {
    if (!youtubeScenes || !currentAnalysis || !onScriptImport) return;
    onScriptImport(youtubeScenes, currentAnalysis, youtubeMood);
    setScriptImported(true);
  };

  const reset = () => {
    setStage("idle");
    setError(null);
    setUrlInput("");
    setYoutubeScenes(null);
    setScriptImported(false);
  };

  const isYT = isYouTubeUrl(urlInput.trim());

  return (
    <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-300 font-medium text-sm">Видео-референс</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">необязательно</span>
          {currentAnalysis && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span>✓</span> Стиль загружен
            </span>
          )}
          {scriptImported && (
            <span className="text-xs text-purple-400">✓ Сценарий импортирован</span>
          )}
        </div>
        <span className="text-slate-500 text-sm">{isExpanded ? "▾" : "▸"}</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
          <p className="text-xs text-slate-500">
            Вставь YouTube ссылку или mp4 URL — AI скопирует кинематографию и/или извлечёт готовый сценарий по сценам.
          </p>

          {/* Idle / Error — input form */}
          {(stage === "idle" || stage === "error") && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="youtube.com/watch?v=... или youtu.be/... или прямая .mp4 ссылка"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                />
              </div>

              {/* YouTube опции */}
              {isYT && onScriptImport && (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAnalyzeMode("style"); handleAnalyze(); }}
                    className="flex-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-xs font-medium py-2.5 rounded-lg transition-colors"
                  >
                    Скопировать стиль
                  </button>
                  <button
                    onClick={() => { setAnalyzeMode("script"); handleAnalyze(); }}
                    className="flex-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium py-2.5 rounded-lg transition-colors"
                  >
                    Извлечь сценарий
                  </button>
                </div>
              )}

              {/* Не YouTube — обычный анализ */}
              {!isYT && (
                <button
                  onClick={handleAnalyze}
                  disabled={!urlInput.trim()}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Анализировать
                </button>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-slate-600">или загрузи файл</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border border-dashed border-white/15 hover:border-white/30 rounded-lg py-3 text-slate-500 hover:text-slate-400 text-sm transition-all"
                >
                  Загрузить видео файл (mp4, mov — до 200 МБ)
                </button>
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>
          )}

          {/* Uploading */}
          {stage === "uploading" && (
            <div className="flex items-center gap-3 text-slate-400 text-sm py-2">
              <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              Загружаю видео в облако...
            </div>
          )}

          {/* Analyzing */}
          {stage === "analyzing" && (
            <div className="space-y-2 py-2">
              <div className="flex items-center gap-3 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                {isYT
                  ? "Gemini смотрит видео на YouTube..."
                  : "Gemini Vision анализирует кинематографию..."}
              </div>
              <div className="text-xs text-slate-600">
                {isYT
                  ? "Нативный анализ YouTube — извлекаем сцены, камеру, монтаж, настроение"
                  : "Извлекаем кадры → анализируем движения камеры, свет, темп"}
              </div>
            </div>
          )}

          {/* Done */}
          {stage === "done" && currentAnalysis && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-500">Стиль камеры</p>
                  <p className="text-xs text-slate-200">{currentAnalysis.cameraStyle}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-500">Темп монтажа</p>
                  <p className="text-xs text-slate-200">{currentAnalysis.pacing}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-500">Освещение</p>
                  <p className="text-xs text-slate-200">{currentAnalysis.lightingStyle}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-500">Цветокоррекция</p>
                  <p className="text-xs text-slate-200">{currentAnalysis.colorGrade}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-500">Движения камеры</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentAnalysis.cameraMovements.map((m, i) => (
                    <span key={`${m}-${i}`} className="bg-purple-900/40 border border-purple-500/30 text-purple-300 text-xs px-2 py-0.5 rounded-full">
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-500">Настроение</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentAnalysis.moodKeywords.map((m, i) => (
                    <span key={`${m}-${i}`} className="bg-slate-800 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
                <p className="text-xs text-green-400 font-medium mb-1">✓ Стиль будет применён к сценарию</p>
                <p className="text-xs text-slate-400">{currentAnalysis.recommendations}</p>
              </div>

              {/* YouTube сцены — импорт сценария */}
              {youtubeScenes && youtubeScenes.length > 0 && onScriptImport && (
                <div className="bg-indigo-900/20 border border-indigo-500/20 rounded-lg p-4 space-y-3">
                  <p className="text-xs text-indigo-300 font-medium">
                    Извлечено {youtubeScenes.length} сцен из YouTube
                  </p>
                  <div className="space-y-2">
                    {youtubeScenes.slice(0, 3).map((s) => (
                      <div key={s.sceneNumber} className="text-xs text-slate-400 flex gap-2">
                        <span className="text-indigo-400 shrink-0">Сцена {s.sceneNumber}:</span>
                        <span className="truncate">{s.descriptionRu ?? s.description}</span>
                      </div>
                    ))}
                    {youtubeScenes.length > 3 && (
                      <p className="text-xs text-slate-600">+{youtubeScenes.length - 3} ещё...</p>
                    )}
                  </div>

                  {scriptImported ? (
                    <p className="text-xs text-green-400 font-medium">✓ Сценарий импортирован на шаг 2</p>
                  ) : (
                    <button
                      onClick={handleImportScript}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                    >
                      Использовать как сценарий →
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={reset}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors underline"
              >
                Загрузить другой референс
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
