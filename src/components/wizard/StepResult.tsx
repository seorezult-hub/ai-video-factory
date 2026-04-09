"use client";

import { useState } from "react";
import { ProjectData } from "@/app/create/page";

type Props = {
  data: ProjectData;
  onPrev: () => void;
};

export function StepResult({ data, onPrev }: Props) {
  const [loading, setLoading] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assemble = async () => {
    setLoading(true);
    setError(null);
    try {
      const selectedClipUrls = data.selectedClips.map((i) => data.videoClips[i]);
      const res = await fetch("/api/generate/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: selectedClipUrls,
          musicUrl: data.musicUrl,
          brandName: data.brandName,
        }),
      });
      if (!res.ok) throw new Error("Assembly failed");
      const { videoUrl } = await res.json();
      setFinalVideoUrl(videoUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Your video is ready</h2>
        <p className="text-slate-400">
          {data.selectedClips.length} scenes selected · {data.brandName}
        </p>
      </div>

      {!finalVideoUrl && !loading && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-1">
            <p>· {data.selectedClips.length} video clips will be merged</p>
            {data.musicUrl && <p>· Background music added</p>}
            <p>· Color correction applied</p>
            <p>· Output: 9:16 vertical (30 sec)</p>
          </div>
          <button
            onClick={assemble}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            Assemble Final Video
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Assembling your video...</p>
          <p className="text-slate-500 text-sm">FFmpeg is merging clips and mixing audio</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={assemble} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {finalVideoUrl && (
        <div className="space-y-6">
          <video
            src={finalVideoUrl}
            controls
            autoPlay
            className="w-full max-w-sm mx-auto rounded-2xl bg-black aspect-[9/16]"
          />

          <div className="flex gap-3">
            <a
              href={finalVideoUrl}
              download={`${data.brandName}-promo.mp4`}
              className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl text-center transition-colors"
            >
              Download MP4
            </a>
            <button
              onClick={() => window.location.href = "/create"}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Create Another
            </button>
          </div>
        </div>
      )}

      {!finalVideoUrl && (
        <button
          onClick={onPrev}
          className="w-full bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
        >
          ← Back to clips
        </button>
      )}
    </div>
  );
}
