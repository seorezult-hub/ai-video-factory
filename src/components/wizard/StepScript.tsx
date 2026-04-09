"use client";

import { useState } from "react";
import { ProjectData, SceneScript } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

export function StepScript({ data, onUpdate, onNext, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateScript = async () => {
    setLoading(true);
    setError(null);
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
        }),
      });
      if (!res.ok) throw new Error("Script generation failed");
      const { script } = await res.json();
      onUpdate({ script });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
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
        <h2 className="text-2xl font-bold mb-1">Your video script</h2>
        <p className="text-slate-400">AI generated 5-6 scenes. Edit any scene if needed.</p>
      </div>

      {!data.script && !loading && (
        <button
          onClick={generateScript}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
        >
          Generate Script with AI
        </button>
      )}

      {loading && (
        <div className="text-center py-16 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Writing your script...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={generateScript} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {data.script && (
        <div className="space-y-4">
          {data.script.map((scene, i) => (
            <div
              key={i}
              className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-purple-400 font-mono text-sm">
                  Scene {scene.sceneNumber} · {scene.duration}
                </span>
              </div>
              <textarea
                value={scene.description}
                onChange={(e) => updateScene(i, { description: e.target.value })}
                rows={2}
                className="w-full bg-transparent text-white text-sm resize-none focus:outline-none"
              />
              <div className="border-t border-white/5 pt-3">
                <label className="text-xs text-slate-500 mb-1 block">Visual prompt (for AI)</label>
                <textarea
                  value={scene.visualPrompt}
                  onChange={(e) => updateScene(i, { visualPrompt: e.target.value })}
                  rows={2}
                  className="w-full bg-white/5 rounded-lg px-3 py-2 text-slate-300 text-xs resize-none focus:outline-none focus:bg-white/10"
                />
              </div>
            </div>
          ))}

          <div className="flex gap-3 pt-2">
            <button
              onClick={goPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={onNext}
              className="flex-2 flex-[2] bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Generate Frames →
            </button>
          </div>
        </div>
      )}

      {data.script && !loading && (
        <button
          onClick={generateScript}
          className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
        >
          Regenerate script
        </button>
      )}
    </div>
  );

  function goPrev() {
    onPrev();
  }
}
