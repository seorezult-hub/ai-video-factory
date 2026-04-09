"use client";

import { useState } from "react";
import Image from "next/image";
import { ProjectData } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

export function StepFrames({ data, onUpdate, onNext, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateFrames = async () => {
    if (!data.script) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: data.script,
          brandName: data.brandName,
          mood: data.mood,
          uploadedImages: data.uploadedImages,
        }),
      });
      if (!res.ok) throw new Error("Frame generation failed");
      const { keyframes } = await res.json();
      onUpdate({ keyframes, selectedFrames: keyframes.map((_: string, i: number) => i) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const toggleFrame = (index: number) => {
    const selected = data.selectedFrames.includes(index)
      ? data.selectedFrames.filter((i) => i !== index)
      : [...data.selectedFrames, index];
    onUpdate({ selectedFrames: selected });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Key frames</h2>
        <p className="text-slate-400">
          One image per scene. Select the ones you want to use.
        </p>
      </div>

      {data.keyframes.length === 0 && !loading && (
        <button
          onClick={generateFrames}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
        >
          Generate Key Frames
        </button>
      )}

      {loading && (
        <div className="text-center py-16 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Generating key frames... (~30 sec)</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={generateFrames} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {data.keyframes.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {data.keyframes.map((url, i) => (
              <button
                key={i}
                onClick={() => toggleFrame(i)}
                className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                  data.selectedFrames.includes(i)
                    ? "border-purple-500 ring-2 ring-purple-500/30"
                    : "border-white/10 opacity-60 hover:opacity-80"
                }`}
              >
                <Image
                  src={url}
                  alt={`Scene ${i + 1}`}
                  fill
                  className="object-cover"
                />
                <div className="absolute top-2 left-2 bg-black/60 text-xs text-white px-2 py-1 rounded">
                  Scene {i + 1}
                </div>
                {data.selectedFrames.includes(i) && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-xs text-white">
                    ✓
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={onNext}
              disabled={data.selectedFrames.length === 0}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Generate Video ({data.selectedFrames.length} scenes) →
            </button>
          </div>

          <button
            onClick={generateFrames}
            className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
          >
            Regenerate all frames
          </button>
        </>
      )}
    </div>
  );
}
