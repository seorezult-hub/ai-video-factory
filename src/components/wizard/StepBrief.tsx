"use client";

import { ProjectData } from "@/app/create/page";

const VIDEO_TYPES = [
  { id: "cosmetics", label: "Cosmetics / Skincare", emoji: "✨" },
  { id: "fashion", label: "Fashion / Apparel", emoji: "👗" },
  { id: "food", label: "Food & Beverage", emoji: "🍽️" },
  { id: "music", label: "Music Video", emoji: "🎵" },
  { id: "tech", label: "Tech Product", emoji: "📱" },
  { id: "real_estate", label: "Real Estate", emoji: "🏠" },
];

const MOODS = ["Luxury", "Energetic", "Soft & Natural", "Bold", "Minimalist", "Playful"];

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
};

export function StepBrief({ data, onUpdate, onNext }: Props) {
  const isValid =
    data.videoType &&
    data.brandName.trim() &&
    data.mood &&
    data.targetAudience.trim() &&
    data.productDescription.trim();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-1">Tell us about your brand</h2>
        <p className="text-slate-400">5-7 questions and we'll build the entire video for you</p>
      </div>

      {/* Video type */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-slate-300">Video type</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {VIDEO_TYPES.map((type) => (
            <button
              key={type.id}
              onClick={() => onUpdate({ videoType: type.id })}
              className={`p-4 rounded-xl border text-left transition-all ${
                data.videoType === type.id
                  ? "border-purple-500 bg-purple-500/10 text-white"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
              }`}
            >
              <div className="text-2xl mb-1">{type.emoji}</div>
              <div className="text-sm font-medium">{type.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Brand name */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">Brand name</label>
        <input
          type="text"
          value={data.brandName}
          onChange={(e) => onUpdate({ brandName: e.target.value })}
          placeholder="e.g. Lumière Paris"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Product description */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">What are you promoting?</label>
        <textarea
          value={data.productDescription}
          onChange={(e) => onUpdate({ productDescription: e.target.value })}
          placeholder="e.g. A luxury anti-aging serum with 24k gold particles for women 35+"
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
        />
      </div>

      {/* Target audience */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">Target audience</label>
        <input
          type="text"
          value={data.targetAudience}
          onChange={(e) => onUpdate({ targetAudience: e.target.value })}
          placeholder="e.g. Women 25-45, urban, premium taste"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Mood */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-slate-300">Video mood</label>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((mood) => (
            <button
              key={mood}
              onClick={() => onUpdate({ mood })}
              className={`px-4 py-2 rounded-full text-sm transition-all ${
                data.mood === mood
                  ? "bg-purple-600 text-white"
                  : "bg-white/5 border border-white/10 text-slate-300 hover:border-white/20"
              }`}
            >
              {mood}
            </button>
          ))}
        </div>
      </div>

      {/* Brand colors */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">
          Brand colors <span className="text-slate-500">(optional)</span>
        </label>
        <input
          type="text"
          value={data.brandColors}
          onChange={(e) => onUpdate({ brandColors: e.target.value })}
          placeholder="e.g. Gold, white, deep navy"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
        />
      </div>

      <button
        onClick={onNext}
        disabled={!isValid}
        className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-lg transition-colors"
      >
        Generate Script →
      </button>
    </div>
  );
}
