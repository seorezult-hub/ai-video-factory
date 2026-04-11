"use client";

import { useState } from "react";
import { ProjectData, SceneScript } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

type Mode = "generate" | "director" | "import";

export function StepScript({ data, onUpdate, onNext, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("generate");
  const [importText, setImportText] = useState("");
  const [regenScene, setRegenScene] = useState<number | null>(null);
  const [scriptMeta, setScriptMeta] = useState<{ score: number; attempts: number; escalated: boolean; model?: string } | null>(null);

  const generateScript = async (directorVision?: string) => {
    setLoading(true);
    setError(null);
    setScriptMeta(null);
    try {
      const res = await fetch("/api/generate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoType: data.videoType,
          brandName: data.brandName,
          brandColors: data.brandColors,
          mood: data.mood,
          targetAudience: data.targetAudience,
          productDescription: data.productDescription,
          platform: data.platform || undefined,
          videoDuration: data.videoDuration,
          uploadedImages: data.uploadedImages,
          brandAnalysis: data.brandAnalysis,
          videoReference: data.videoReference ?? undefined,
          directorVision: directorVision ?? data.directorVision ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Ошибка генерации сценария");
      const json = await res.json();
      const { script, _meta } = json;
      if (_meta) setScriptMeta(_meta);
      onUpdate({ script });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  const parseScript = async () => {
    if (!importText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/script/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptText: importText,
          videoDuration: data.videoDuration,
          brandName: data.brandName,
          brandColors: data.brandColors,
          mood: data.mood,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Ошибка разбора сценария");
      }
      const { script } = await res.json();
      onUpdate({ script });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  const regenerateSingleScene = async (sceneIdx: number) => {
    if (!data.script) return;
    setRegenScene(sceneIdx);
    try {
      const res = await fetch("/api/generate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoType: data.videoType,
          brandName: data.brandName,
          brandColors: data.brandColors,
          mood: data.mood,
          targetAudience: data.targetAudience,
          productDescription: data.productDescription,
          platform: data.platform || undefined,
          videoDuration: data.videoDuration,
          uploadedImages: data.uploadedImages,
          directorVision: `REGENERATE ONLY scene ${sceneIdx + 1}. Keep the same narrative arc and other scenes' style. Current scenes context: ${JSON.stringify(data.script.map((s, i) => i === sceneIdx ? null : { sceneNumber: s.sceneNumber, description: s.description }))}. Generate ONLY 1 scene — scene number ${sceneIdx + 1} with a fresh creative take.`,
          videoReference: data.videoReference ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Ошибка перегенерации");
      const { script: newScenes } = await res.json();
      if (newScenes && newScenes.length > 0) {
        const updated = [...data.script];
        updated[sceneIdx] = { ...newScenes[0], sceneNumber: sceneIdx + 1 };
        onUpdate({ script: updated });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setRegenScene(null);
    }
  };

  const updateScene = (index: number, updates: Partial<SceneScript>) => {
    if (!data.script) return;
    const newScript = [...data.script];
    newScript[index] = { ...newScript[index], ...updates };
    onUpdate({ script: newScript });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Сценарий ролика</h2>
        <p className="text-slate-400">
          {data.script ? `${data.script.length} сцен сгенерировано. Можешь отредактировать любую.` : "AI напишет сценарий под твой бриф."}
        </p>
      </div>

      {!data.script && !loading && (
        <div className="space-y-4">
          {/* Переключатель режима */}
          <div className="flex bg-white/5 rounded-xl p-1 gap-1">
            {(
              [
                { id: "generate" as Mode, label: "AI-генерация" },
                { id: "director" as Mode, label: "Моё видение" },
                { id: "import" as Mode, label: "Вставить текст" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  mode === m.id ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "generate" && (
            <button
              onClick={() => generateScript()}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-lg transition-colors"
            >
              Сгенерировать сценарий с AI
            </button>
          )}

          {mode === "director" && (
            <div className="space-y-3">
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 text-sm text-slate-400 space-y-1">
                <p className="text-purple-300 font-medium">Напиши своими словами что хочешь видеть в ролике</p>
                <p className="text-xs">AI переведёт твоё видение в профессиональный сценарий с промтами</p>
              </div>
              <textarea
                value={data.directorVision}
                onChange={(e) => onUpdate({ directorVision: e.target.value })}
                placeholder={`Например: Хочу показать как Nike кроссовки дают силу. Сначала спортсмен устал, потом надел кроссовки, почувствовал энергию, побежал по ночному городу и взлетел в небо. В конце лого Nike на всё небо.`}
                rows={5}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm resize-none focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={() => generateScript(data.directorVision)}
                disabled={!data.directorVision?.trim() || loading}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-lg transition-colors"
              >
                Превратить в сценарий →
              </button>
            </div>
          )}

          {mode === "import" && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-1">
                <p>Вставь готовый сценарий — AI разобьёт его на {data.videoDuration === "15-30" ? "3" : data.videoDuration === "45-60" ? "7" : "5"} сцен, добавит визуальные промты и переводы</p>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`Сцена 1: Утро. Модель выходит из дома с рюкзаком Befree...\nСцена 2: Городская улица. Она уверенно идёт сквозь толпу...\nСцена 3: Финал. Крупный план логотипа на кармане рюкзака...`}
                rows={8}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm resize-none focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={parseScript}
                disabled={!importText.trim()}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
              >
                Разобрать на сцены →
              </button>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-16 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Пишу сценарий...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button
            onClick={mode === "import" ? parseScript : () => generateScript(mode === "director" ? data.directorVision : undefined)}
            className="ml-3 underline"
          >
            Повторить
          </button>
        </div>
      )}

      {data.script && (
        <div className="space-y-4">
          {data.script.map((scene, i) => (
            <div
              key={scene.sceneNumber}
              className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-purple-400 font-mono text-sm">
                  Сцена {scene.sceneNumber} · {scene.duration}
                </span>
                <span className="text-slate-500 text-xs">{scene.cameraMovement}</span>
              </div>

              {/* Русский перевод — основное что видит пользователь */}
              {scene.descriptionRu && (
                <p className="text-white text-sm leading-relaxed">{scene.descriptionRu}</p>
              )}

              {/* Английский оригинал — для понимания промпта */}
              <div className="border-t border-white/5 pt-2">
                <p className="text-xs text-slate-500 mb-1">На английском (для AI-генерации кадра):</p>
                <textarea
                  value={scene.description}
                  onChange={(e) => updateScene(i, { description: e.target.value })}
                  rows={2}
                  className="w-full bg-transparent text-slate-400 text-xs resize-none focus:outline-none"
                />
              </div>
              <div className="border-t border-white/5 pt-3">
                <label className="text-xs text-slate-500 mb-1 block">
                  Визуальный промт (для AI-генерации)
                </label>
                <textarea
                  value={scene.visualPrompt}
                  onChange={(e) => updateScene(i, { visualPrompt: e.target.value })}
                  rows={2}
                  className="w-full bg-white/5 rounded-lg px-3 py-2 text-slate-300 text-xs resize-none focus:outline-none focus:bg-white/10"
                />
              </div>
              <button
                onClick={() => regenerateSingleScene(i)}
                disabled={regenScene !== null}
                className="mt-2 w-full text-xs text-slate-500 hover:text-slate-300 bg-white/3 hover:bg-white/8 border border-white/5 rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1"
              >
                {regenScene === i ? (
                  <>
                    <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    Перегенерирую...
                  </>
                ) : "↺ Перегенерировать эту сцену"}
              </button>
            </div>
          ))}

          {scriptMeta && data.script && (
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm ${
              scriptMeta.score >= 85
                ? "bg-green-500/10 border-green-500/20 text-green-400"
                : scriptMeta.score >= 70
                ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}>
              <span className="font-bold text-base">{scriptMeta.score}/100</span>
              <div className="flex-1">
                <p className="font-medium">
                  {scriptMeta.score >= 85 ? "Отличный сценарий" : scriptMeta.score >= 70 ? "Хороший сценарий" : "Слабый сценарий"}
                </p>
                <p className="text-xs opacity-70">
                  {scriptMeta.model ?? "—"} · попыток: {scriptMeta.attempts}
                  {scriptMeta.escalated ? " · Claude Sonnet (escalation)" : ""}
                </p>
              </div>
              {scriptMeta.score < 80 && (
                <button
                  onClick={() => generateScript()}
                  className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded-lg transition-colors"
                >
                  Пересоздать
                </button>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              ← Назад
            </button>
            <button
              onClick={onNext}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Генерировать кадры →
            </button>
          </div>

          <button
            onClick={mode === "import" ? parseScript : () => generateScript()}
            disabled={loading}
            className="w-full text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed text-sm py-2 transition-colors"
          >
            {mode === "import" ? "Перераспределить сцены" : "Перегенерировать сценарий"}
          </button>
        </div>
      )}
    </div>
  );
}
