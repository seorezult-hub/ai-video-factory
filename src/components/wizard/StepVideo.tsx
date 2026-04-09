"use client";

import { useState } from "react";
import { ProjectData } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

export function StepVideo({ data, onUpdate, onNext, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFrameUrls = data.selectedFrames.map((i) => data.keyframes[i]);

  const generateVideo = async () => {
    if (!data.script) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: data.script.filter((_, i) => data.selectedFrames.includes(i)),
          keyframes: selectedFrameUrls,
          mood: data.mood,
        }),
      });
      if (!res.ok) throw new Error("Video generation failed");
      const { videoClips, musicUrl } = await res.json();
      onUpdate({ videoClips, musicUrl, selectedClips: videoClips.map((_: string, i: number) => i) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const toggleClip = (index: number) => {
    const selected = data.selectedClips.includes(index)
      ? data.selectedClips.filter((i) => i !== index)
      : [...data.selectedClips, index];
    onUpdate({ selectedClips: selected });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Video clips</h2>
        <p className="text-slate-400">
          AI generated one clip per scene. Select the ones you like.
        </p>
      </div>

      {data.videoClips.length === 0 && !loading && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-2">
            <p>Will generate {selectedFrameUrls.length} video clips (5-10 sec each)</p>
            <p>Uses Kling Free API · ~90 sec per clip</p>
            <p>Estimated time: {selectedFrameUrls.length * 2}-{selectedFrameUrls.length * 3} minutes</p>
          </div>
          <button
            onClick={generateVideo}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            Generate Video Clips
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Generating video clips...</p>
          <p className="text-slate-500 text-sm">This takes 2-5 minutes. You can leave this tab open.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={generateVideo} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {data.videoClips.length > 0 && (
        <>
          <div className="space-y-4">
            {data.videoClips.map((url, i) => (
              <div
                key={i}
                className={`border-2 rounded-xl overflow-hidden transition-all ${
                  data.selectedClips.includes(i)
                    ? "border-purple-500"
                    : "border-white/10 opacity-60"
                }`}
              >
                <video
                  src={url}
                  controls
                  className="w-full aspect-video bg-black"
                />
                <div className="flex items-center justify-between px-4 py-3 bg-white/5">
                  <span className="text-sm text-slate-400">Scene {i + 1}</span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {/* TODO: thumbs up — save as successful */}}
                      className="text-slate-400 hover:text-green-400 transition-colors text-lg"
                      title="Good result"
                    >
                      👍
                    </button>
                    <button
                      onClick={() => {/* TODO: thumbs down — mark bad */}}
                      className="text-slate-400 hover:text-red-400 transition-colors text-lg"
                      title="Bad result"
                    >
                      👎
                    </button>
                    <button
                      onClick={() => toggleClip(i)}
                      className={`text-sm px-3 py-1 rounded-lg transition-colors ${
                        data.selectedClips.includes(i)
                          ? "bg-purple-600 text-white"
                          : "bg-white/10 text-slate-300"
                      }`}
                    >
                      {data.selectedClips.includes(i) ? "Selected" : "Select"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.musicUrl && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-2">Background music</p>
              <audio src={data.musicUrl} controls className="w-full" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={onNext}
              disabled={data.selectedClips.length === 0}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Assemble Final Video →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
