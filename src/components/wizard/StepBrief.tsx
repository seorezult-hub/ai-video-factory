"use client";

import { useState, useRef, useEffect } from "react";
import { ProjectData, BrandAnalysis, VideoDuration } from "@/app/create/page";

const MAX_BRANDS = 5;

type BrandKit = {
  id: string;
  brand_name: string;
  data: {
    brandName: string;
    brandColors: string;
    productDescription: string;
    targetAudience: string;
    videoType: string;
    mood: string;
    platform: string;
    websiteUrl: string;
  };
  updated_at: string;
};
import { HeroCollageModal } from "@/components/wizard/HeroCollageModal";
import { VideoReferenceUpload } from "@/components/wizard/VideoReferenceUpload";

const VIDEO_TYPES = [
  { id: "cosmetics", label: "Косметика / Уход", emoji: "✨" },
  { id: "fashion", label: "Мода / Одежда", emoji: "👗" },
  { id: "food", label: "Еда и напитки", emoji: "🍽️" },
  { id: "music", label: "Музыкальный клип", emoji: "🎵" },
  { id: "tech", label: "Технологии", emoji: "📱" },
  { id: "real_estate", label: "Недвижимость", emoji: "🏠" },
];

const MOODS = ["Люкс", "Энергия", "Мягко и натурально", "Дерзко", "Минимализм", "Игриво"];

const DURATIONS: { value: VideoDuration; label: string; scenes: number; cost: string; tag?: string }[] = [
  { value: "15-single", label: "15 сек · 1 план", scenes: 1, cost: "~$0.17", tag: "Кинематограф" },
  { value: "15-30",     label: "15–30 сек",        scenes: 3, cost: "~$0.45" },
  { value: "30-45",     label: "30–45 сек",        scenes: 5, cost: "~$0.75" },
  { value: "45-60",     label: "45–60 сек",        scenes: 7, cost: "~$1.05" },
];

const TIERS = [
  { id: "start" as const,  label: "Старт",  price: "Бесплатно",   videos: "2 ролика" },
  { id: "pro" as const,    label: "Про",    price: "2 990 ₽/мес", videos: "15 роликов" },
  { id: "profi" as const,  label: "Профи",  price: "9 990 ₽/мес", videos: "50 роликов" },
  { id: "studio" as const, label: "Студия", price: "29 990 ₽/мес",videos: "∞ роликов" },
];

type Tier = "start" | "pro" | "profi" | "studio";

const TIER_RANK: Record<Tier, number> = { start: 0, pro: 1, profi: 2, studio: 3 };

function tierGte(current: Tier, min: Tier) {
  return TIER_RANK[current] >= TIER_RANK[min];
}

type ImageSlot = "hero" | "product" | "product-back" | "logo" | "product-item" | "partner-logo";
type SlotType = "hero" | "product" | "logo" | "detail" | "other";
type ImageScore = { score: number; grade: string; feedback: string; tips: string[] };

const SLOT_TO_TYPE: Record<ImageSlot, SlotType> = {
  "hero": "hero",
  "product": "product",
  "product-back": "detail",
  "logo": "logo",
  "product-item": "other",
  "partner-logo": "logo",
};

function getMJPrompt(slot: ImageSlot, brandName: string, productDescription: string, mood: string): { type: "mj" | "tip"; text: string } {
  const moodMap: Record<string, string> = {
    "Люкс": "luxury, premium, elegant aesthetic",
    "Энергия": "energetic, dynamic, vibrant colors",
    "Мягко и натурально": "soft, natural, organic lighting",
    "Дерзко": "bold, edgy, dramatic contrast",
    "Минимализм": "minimalist, clean, pure white",
    "Игриво": "playful, colorful, fun mood",
  };
  const moodStr = moodMap[mood] ?? "professional, polished look";
  const product = productDescription || "product";

  switch (slot) {
    case "hero":
      return { type: "mj", text: `/imagine prompt: beautiful model, full body studio portrait, holding or near ${product}, white seamless background, ${moodStr}, professional fashion photography, sharp focus, photorealistic, ultra detailed --ar 2:3 --v 7 --style raw --q 2` };
    case "product":
      return { type: "mj", text: `/imagine prompt: ${product} product photography, front view, pure white background, studio softbox lighting, sharp focus, commercial shot, ultra detailed, no shadows --ar 1:1 --v 7 --style raw --q 2` };
    case "product-back":
      return { type: "mj", text: `/imagine prompt: ${product} back view or close-up texture detail, white background, professional macro photography, sharp crisp focus, ${moodStr} --ar 1:1 --v 7 --q 2` };
    case "logo":
      return { type: "tip", text: "Логотип создай на looka.com, brandmark.io или закажи у дизайнера. Нужен PNG 1000×1000px с прозрачным фоном (alpha channel). Векторный SVG тоже подойдёт." };
    case "product-item":
      return { type: "mj", text: `/imagine prompt: ${product} styled flat lay, ${moodStr}, white marble or wood surface, professional product photography, top-down view, high resolution --ar 1:1 --v 7 --q 2` };
    case "partner-logo":
      return { type: "tip", text: "Запроси PNG лого у партнёра. Обязательно с прозрачным фоном (alpha channel), минимум 500×500px." };
  }
}

function ScoreBadge({ score, grade }: { score: number; grade: string }) {
  const color =
    grade === "A" ? "bg-green-500/20 text-green-400 border-green-500/30" :
    grade === "B" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
    grade === "C" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
                   "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={`${color} border text-xs font-bold px-1.5 py-0.5 rounded`}>
      {grade} {score}/100
    </span>
  );
}

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
};

export function StepBrief({ data, onUpdate, onNext }: Props) {
  const tier: Tier = data.tier ?? "pro";

  const [firecrawlKey, setFirecrawlKey] = useState(() => {
    try { return sessionStorage.getItem("firecrawl_key") ?? ""; } catch { return ""; }
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [uploadingImages, setUploadingImages] = useState<ImageSlot | null>(null);
  const [scoringSlot, setScoringSlot] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ImageSlot | null>(null);
  const [showCollageModal, setShowCollageModal] = useState(false);
  const [extractingDNA, setExtractingDNA] = useState(false);
  const [dnaError, setDnaError] = useState<string | null>(null);
  const [expandedMJ, setExpandedMJ] = useState<ImageSlot | null>(null);
  const [expandedTips, setExpandedTips] = useState<number | null>(null);
  const [copiedMJ, setCopiedMJ] = useState<ImageSlot | null>(null);
  const [enhancingSlot, setEnhancingSlot] = useState<number | null>(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoGenError, setAutoGenError] = useState<string | null>(null);
  const [heroVariants, setHeroVariants] = useState<string[]>([]);
  const [heroProfile, setHeroProfile] = useState<{ gender: string; age: string; style: string } | null>(null);
  const [smartQuestions, setSmartQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);

  const [savedBrands, setSavedBrands] = useState<BrandKit[]>([]);
  const [brandSavedToast, setBrandSavedToast] = useState(false);
  const [brandsLoading, setBrandsLoading] = useState(false);

  useEffect(() => {
    setBrandsLoading(true);
    fetch("/api/brand-kits")
      .then((res) => {
        if (!res.ok) return;
        return res.json();
      })
      .then((json) => {
        if (json?.brands && Array.isArray(json.brands)) {
          setSavedBrands(json.brands.slice(0, MAX_BRANDS));
        }
      })
      .catch(() => {})
      .finally(() => setBrandsLoading(false));
  }, []);

  const heroInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const productBackInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const productItemInputRef = useRef<HTMLInputElement>(null);
  const partnerLogoInputRef = useRef<HTMLInputElement>(null);

  const heroPhoto = data.uploadedImages[0] ?? null;
  const productPhoto = data.uploadedImages[1] ?? null;
  const productBackPhoto = data.uploadedImages[2] ?? null;
  const logoPhoto = data.uploadedImages[3] ?? null;
  const productItemPhoto = data.uploadedImages[4] ?? null;
  const partnerLogoPhoto = data.uploadedImages[5] ?? null;

  const SLOT_INDEX: Record<ImageSlot, number> = {
    "hero": 0,
    "product": 1,
    "product-back": 2,
    "logo": 3,
    "product-item": 4,
    "partner-logo": 5,
  };

  const uploadFiles = async (files: FileList | File[], slot: ImageSlot) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const maxMB = 10;
    const validFiles: File[] = [];
    setImageError(null);

    for (const f of Array.from(files)) {
      if (!allowed.includes(f.type)) { setImageError(`${f.name}: нужен JPG, PNG или WEBP`); return; }
      if (f.size > maxMB * 1024 * 1024) { setImageError(`${f.name}: максимум ${maxMB} МБ`); return; }
      validFiles.push(f);
    }

    if (validFiles.length > 1) { setImageError("Загрузи один файл в этот слот"); return; }

    setUploadingImages(slot);
    try {
      const ext = validFiles[0].name.split(".").pop() ?? "jpg";
      const key = `brand-assets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const fd = new FormData();
      fd.append("file", validFiles[0]);
      fd.append("key", key);
      const res = await fetch("/api/storage/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Ошибка загрузки файла");
      const { url } = await res.json();

      const idx = SLOT_INDEX[slot];
      const newImages = [...data.uploadedImages];
      while (newImages.length <= idx) newImages.push("");
      newImages[idx] = url;

      if (process.env.NEXT_PUBLIC_GEMINI_QUALITY_SCORE !== "off") {
        setScoringSlot(idx);
        try {
          const scoreRes = await fetch("/api/analyze/asset-quality", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: url, slotType: SLOT_TO_TYPE[slot] }),
          });
          if (scoreRes.ok) {
            const scoreData = await scoreRes.json();
            const newScores = [...(data.imageScores ?? [])];
            while (newScores.length <= idx) newScores.push(null);
            newScores[idx] = scoreData;
            onUpdate({ uploadedImages: newImages, imageScores: newScores });
          } else {
            onUpdate({ uploadedImages: newImages });
          }
        } catch { onUpdate({ uploadedImages: newImages }); } finally {
          setScoringSlot(null);
        }
      } else {
        onUpdate({ uploadedImages: newImages });
      }
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploadingImages(null);
    }
  };

  const removeImage = (idx: number) => {
    const updated = [...data.uploadedImages];
    updated[idx] = "";
    onUpdate({ uploadedImages: updated });
  };

  const enhanceImage = async (idx: number, slot: ImageSlot, enhanceType: "remove-bg" | "upscale" | "both") => {
    const currentUrl = data.uploadedImages[idx];
    if (!currentUrl) return;
    setEnhancingSlot(idx);
    try {
      const res = await fetch("/api/enhance/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: currentUrl, enhanceType, slotType: SLOT_TO_TYPE[slot] }),
      });
      if (!res.ok) throw new Error("Ошибка улучшения");
      const { url } = await res.json();

      const updatedImages = [...data.uploadedImages];
      updatedImages[idx] = url;
      const updatedScores = [...(data.imageScores ?? [])];
      updatedScores[idx] = null;
      onUpdate({ uploadedImages: updatedImages, imageScores: updatedScores });

      const scoreRes = await fetch("/api/analyze/asset-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url, slotType: SLOT_TO_TYPE[slot] }),
      });
      if (scoreRes.ok) {
        const scoreData = await scoreRes.json();
        const freshScores = [...(data.imageScores ?? [])];
        while (freshScores.length <= idx) freshScores.push(null);
        freshScores[idx] = scoreData;
        onUpdate({ imageScores: freshScores });
      }
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Ошибка улучшения");
    } finally {
      setEnhancingSlot(null);
    }
  };

  const saveKey = (val: string) => {
    setFirecrawlKey(val);
    try { sessionStorage.setItem("firecrawl_key", val); } catch {}
  };

  const analyzeWebsite = async () => {
    const rawUrl = data.websiteUrl.trim();
    if (!rawUrl) return;
    const urlToValidate = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    try { new URL(urlToValidate); } catch {
      setAnalyzeError("Введи корректный URL, например: https://example.com");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/analyze/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: data.websiteUrl.trim(),
          firecrawlKey: firecrawlKey.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Ошибка анализа");
      }
      const { brandData, jtbd } = await res.json();
      onUpdate({
        brandName: brandData.brandName || data.brandName,
        productDescription: brandData.productDescription || data.productDescription,
        targetAudience: brandData.targetAudience || data.targetAudience,
        brandColors: brandData.brandColors || data.brandColors,
        videoType: brandData.videoType || data.videoType,
        mood: brandData.mood || data.mood,
        brandAnalysis: jtbd as BrandAnalysis,
      });
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setAnalyzing(false);
    }
  };

  const extractBrandDNA = async () => {
    const imageUrls = data.uploadedImages.filter(Boolean);
    if (imageUrls.length === 0) return;
    setExtractingDNA(true);
    setDnaError(null);
    try {
      const res = await fetch("/api/analyze/brand-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrls }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка анализа");
      const { dna } = json;
      onUpdate({
        brandColors: dna.brandColors ?? data.brandColors,
        mood: dna.mood ?? data.mood,
        videoType: dna.videoType ?? data.videoType,
      });
    } catch (e) {
      setDnaError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setExtractingDNA(false);
    }
  };

  const autoGenerateAssets = async () => {
    setAutoGenerating(true);
    setAutoGenError(null);
    setHeroVariants([]);
    setHeroProfile(null);
    try {
      const res = await fetch("/api/generate/auto-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: data.brandName,
          productDescription: data.productDescription,
          targetAudience: data.targetAudience,
          mood: data.mood,
          videoType: data.videoType,
          brandColors: data.brandColors,
          aspectRatio: data.aspectRatio,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Ошибка генерации");

      if (result.heroProfile) setHeroProfile(result.heroProfile);

      if (result.heroVariants?.length > 1) {
        setHeroVariants(result.heroVariants);
        if (result.productUrl) {
          const updated = [...data.uploadedImages];
          while (updated.length <= 1) updated.push("");
          updated[1] = result.productUrl;
          onUpdate({ uploadedImages: updated });
        }
      } else if (result.heroUrl || result.productUrl) {
        const updated = [...data.uploadedImages];
        if (result.heroUrl) {
          while (updated.length <= 0) updated.push("");
          updated[0] = result.heroUrl;
        }
        if (result.productUrl) {
          while (updated.length <= 1) updated.push("");
          updated[1] = result.productUrl;
        }
        onUpdate({ uploadedImages: updated });
      }

      if (result.errors?.hero && result.errors?.product) {
        setAutoGenError(`Герой: ${result.errors.hero}. Продукт: ${result.errors.product}`);
      } else if (result.errors?.hero) {
        setAutoGenError(`Герой не сгенерирован: ${result.errors.hero}`);
      } else if (result.errors?.product) {
        setAutoGenError(`Продукт не сгенерирован: ${result.errors.product}`);
      }
    } catch (e) {
      setAutoGenError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAutoGenerating(false);
    }
  };

  const selectHeroVariant = (url: string) => {
    const updated = [...data.uploadedImages];
    while (updated.length <= 0) updated.push("");
    updated[0] = url;
    onUpdate({ uploadedImages: updated });
    setHeroVariants([]);
  };

  const saveBrandKit = async () => {
    if (!data.brandName.trim()) return;
    const brandData = {
      brandName: data.brandName,
      brandColors: data.brandColors ?? "",
      productDescription: data.productDescription,
      targetAudience: data.targetAudience ?? "",
      videoType: data.videoType ?? "",
      mood: data.mood ?? "",
      platform: data.platform ?? "",
      websiteUrl: data.websiteUrl ?? "",
    };
    try {
      const res = await fetch("/api/brand-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: data.brandName.trim(), data: brandData }),
      });
      if (!res.ok) return;
      const { id } = await res.json();
      setSavedBrands((prev) => {
        const filtered = prev.filter((b) => b.brand_name !== data.brandName.trim());
        const updated: BrandKit = { id, brand_name: data.brandName.trim(), data: brandData, updated_at: new Date().toISOString() };
        return [updated, ...filtered].slice(0, MAX_BRANDS);
      });
      setBrandSavedToast(true);
      setTimeout(() => setBrandSavedToast(false), 2000);
    } catch {}
  };

  const deleteBrand = async (id: string) => {
    try {
      const res = await fetch(`/api/brand-kits?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return;
      setSavedBrands((prev) => prev.filter((b) => b.id !== id));
    } catch {}
  };

  const loadBrand = (brand: BrandKit) => {
    onUpdate({
      brandName: brand.data.brandName,
      brandColors: brand.data.brandColors,
      productDescription: brand.data.productDescription,
      targetAudience: brand.data.targetAudience,
      videoType: brand.data.videoType,
      mood: brand.data.mood,
      platform: brand.data.platform,
      websiteUrl: brand.data.websiteUrl,
    });
  };

  const isValid =
    data.videoType &&
    data.brandName.trim() &&
    data.mood &&
    data.productDescription.trim() &&
    (tier === "start" || data.targetAudience.trim());

  function ImageSlotCard({
    slot, inputRef, photo, idx, badge, badgeColor, label, hint, req,
  }: {
    slot: ImageSlot;
    inputRef: React.RefObject<HTMLInputElement | null>;
    photo: string | null;
    idx: number;
    badge: string;
    badgeColor: string;
    label: string;
    hint: string;
    req: string;
  }) {
    return (
      <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4 space-y-3 backdrop-blur-sm hover:border-white/15 transition-colors">
        <div className="flex items-center gap-2">
          <span className={`${badgeColor} text-white text-xs font-bold px-2.5 py-0.5 rounded-lg`}>{badge}</span>
          <span className="text-white text-sm font-semibold">{label}</span>
          <span className="text-slate-500 text-xs ml-auto">{hint}</span>
        </div>
        <p className="text-xs text-slate-600">{req}</p>
        {photo ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={label} className="w-14 h-14 object-cover rounded-lg border border-white/20" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {scoringSlot === idx ? (
                    <span className="text-slate-400 text-xs flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin inline-block" />
                      Оцениваю...
                    </span>
                  ) : (data.imageScores?.[idx]) ? (
                    <>
                      <ScoreBadge score={(data.imageScores[idx] as ImageScore).score} grade={(data.imageScores[idx] as ImageScore).grade} />
                      <span className="text-xs text-slate-400">{(data.imageScores[idx] as ImageScore).feedback}</span>
                    </>
                  ) : (
                    <span className="text-xs text-green-400">✓ Загружено</span>
                  )}
                  {idx === 0 && data.heroCollageUrl && (
                    <span className="text-xs text-purple-400">· Коллаж создан</span>
                  )}
                </div>
                {(data.imageScores?.[idx] as ImageScore)?.grade === "C" || (data.imageScores?.[idx] as ImageScore)?.grade === "F" ? (
                  <button
                    onClick={() => setExpandedTips(expandedTips === idx ? null : idx)}
                    className="text-xs text-orange-400 hover:text-orange-300 underline"
                  >
                    {expandedTips === idx ? "▾ скрыть советы" : "▸ как улучшить?"}
                  </button>
                ) : null}
              </div>
              <button onClick={() => removeImage(idx)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Удалить</button>
            </div>
            {expandedTips === idx && (data.imageScores?.[idx] as ImageScore)?.tips?.length > 0 && (
              <ul className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2 space-y-1">
                {(data.imageScores[idx] as ImageScore).tips.map((tip, i) => (
                  <li key={i} className="text-xs text-orange-300">• {tip}</li>
                ))}
              </ul>
            )}
            {enhancingSlot === idx ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" />
                Улучшаю через fal.ai... ~30–60 сек
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(slot === "logo" || slot === "partner-logo" || slot === "product" || (data.imageScores?.[idx] as ImageScore)?.grade === "C" || (data.imageScores?.[idx] as ImageScore)?.grade === "F") && (
                  <button
                    onClick={() => enhanceImage(idx, slot, "remove-bg")}
                    className="text-xs bg-cyan-900/30 hover:bg-cyan-900/50 border border-cyan-500/30 text-cyan-300 px-2 py-1 rounded-lg transition-colors"
                    title="Удалить фон через fal-ai/imageutils/rembg (~$0.001)"
                  >
                    ✂ Убрать фон
                  </button>
                )}
                {((data.imageScores?.[idx] as ImageScore)?.grade === "C" || (data.imageScores?.[idx] as ImageScore)?.grade === "F" || (data.imageScores?.[idx] as ImageScore)?.score < 85) && (
                  <button
                    onClick={() => enhanceImage(idx, slot, "upscale")}
                    className="text-xs bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-500/30 text-indigo-300 px-2 py-1 rounded-lg transition-colors"
                    title="Повысить разрешение ×4 через fal-ai/clarity-upscaler (~$0.03)"
                  >
                    ↑ Повысить разрешение ×4
                  </button>
                )}
                {(slot === "logo" || slot === "partner-logo") && (
                  <button
                    onClick={() => enhanceImage(idx, slot, "both")}
                    className="text-xs bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 text-purple-300 px-2 py-1 rounded-lg transition-colors"
                    title="Убрать фон + повысить разрешение (~$0.03)"
                  >
                    ✦ Подготовить лого полностью
                  </button>
                )}
              </div>
            )}
            {idx === 0 && (
              <button
                onClick={() => setShowCollageModal(true)}
                className="w-full bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-500/60 text-purple-300 text-xs font-medium py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <span>✦</span>
                {data.heroCollageUrl ? "Пересоздать коллаж героя (MJ v7)" : "Создать коллаж героя (MJ v7 --cref)"}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(slot); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); uploadFiles(e.dataTransfer.files, slot); }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 ${dragOver === slot ? "border-purple-400 bg-purple-500/10 scale-[1.01]" : "border-white/10 hover:border-purple-500/40 hover:bg-white/3"}`}
            >
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files, slot)} />
              {uploadingImages === slot
                ? <span className="text-slate-400 text-xs flex items-center justify-center gap-2"><span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin inline-block" />Загружаю...</span>
                : <span className="text-slate-400 text-xs">Нажми или перетащи</span>}
            </div>
            {slot !== "partner-logo" && (
              <button
                onClick={() => setExpandedMJ(expandedMJ === slot ? null : slot)}
                className="w-full text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 px-1"
              >
                <span>{expandedMJ === slot ? "▾" : "▸"}</span>
                {expandedMJ === slot ? "Скрыть" : "✦ Как получить идеальное фото"}
              </button>
            )}
            {expandedMJ === slot && (() => {
              const mj = getMJPrompt(slot, data.brandName, data.productDescription, data.mood);
              return (
                <div className={`rounded-lg p-3 space-y-2 ${mj.type === "mj" ? "bg-indigo-900/20 border border-indigo-500/20" : "bg-slate-800/60 border border-white/5"}`}>
                  {mj.type === "mj" ? (
                    <>
                      <p className="text-xs text-indigo-300 font-medium">Промт для Midjourney (v7):</p>
                      <div className="bg-black/30 rounded px-2 py-2 font-mono text-xs text-slate-300 break-all leading-relaxed">
                        {mj.text}
                      </div>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(mj.text);
                          setCopiedMJ(slot);
                          setTimeout(() => setCopiedMJ(null), 2000);
                        }}
                        className="text-xs bg-indigo-600/50 hover:bg-indigo-600 text-indigo-200 px-2 py-1 rounded transition-colors"
                      >
                        {copiedMJ === slot ? "✓ Скопировано" : "Скопировать промт"}
                      </button>
                      <p className="text-xs text-slate-500">
                        1. Открой <a href="https://www.midjourney.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">midjourney.com</a> → вставь промт → генерируй → скачай лучший вариант → загрузи сюда
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-300">{mj.text}</p>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  }

  const fetchSmartQuestions = async () => {
    setLoadingQuestions(true);
    setSmartQuestions([]);
    try {
      const res = await fetch("/api/generate/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoType: data.videoType,
          brandName: data.brandName,
          productDescription: data.productDescription,
          mood: data.mood,
          targetAudience: data.targetAudience,
          hasImages: data.uploadedImages.some(Boolean),
          platform: data.platform,
        }),
      });
      if (!res.ok) throw new Error("Ошибка");
      const json = await res.json();
      setSmartQuestions(json.questions ?? []);
      setShowQuestions(true);
    } catch {
      setSmartQuestions(["Опишите, какую эмоцию должен испытать зритель после просмотра?", "Есть ли видеореференс с похожим стилем?", "Кто герой ролика — реальный человек или образ?"]);
      setShowQuestions(true);
    } finally {
      setLoadingQuestions(false);
    }
  };

  return (
    <div className="space-y-10 text-white">

      {/* Brand Kit */}
      {(savedBrands.length > 0 || brandsLoading) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-300">Мои бренды</span>
            <button
              onClick={saveBrandKit}
              disabled={!data.brandName.trim()}
              className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-40 disabled:cursor-not-allowed border border-purple-500/30 hover:border-purple-500/60 px-3 py-1.5 rounded-lg transition-all"
            >
              + Сохранить бренд
            </button>
          </div>
          {brandsLoading ? (
            <div className="flex gap-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-9 w-24 bg-slate-800 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedBrands.map((brand) => (
                <div
                  key={brand.id}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg px-3 py-2 transition-colors group"
                >
                  <button
                    onClick={() => loadBrand(brand)}
                    className="text-sm text-slate-200 hover:text-white transition-colors"
                  >
                    {brand.brand_name}
                  </button>
                  <button
                    onClick={() => deleteBrand(brand.id)}
                    className="text-slate-500 hover:text-red-400 transition-colors text-xs leading-none ml-1"
                    aria-label="Удалить бренд"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {brandSavedToast && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span>✓</span> Бренд сохранён
            </p>
          )}
        </div>
      )}

      {/* Тарифы */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Выбери уровень ролика</h2>
          <p className="text-slate-400 mt-1 text-sm">Чем выше тариф — тем больше ассетов и инструментов</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TIERS.map((t) => (
            <button
              key={t.id}
              onClick={() => onUpdate({ tier: t.id })}
              className={`relative rounded-2xl p-4 border text-left transition-all duration-200 group ${
                tier === t.id
                  ? "bg-gradient-to-br from-purple-600 to-indigo-700 border-purple-500 shadow-lg shadow-purple-900/40 ring-2 ring-purple-500/50"
                  : "bg-white/5 border-white/10 hover:border-white/25 hover:bg-white/8 backdrop-blur-sm"
              }`}
            >
              {t.id === "profi" && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs px-3 py-0.5 rounded-full whitespace-nowrap font-bold shadow-md">
                  Популярный
                </span>
              )}
              <div className={`font-bold text-sm ${tier === t.id ? "text-white" : "text-slate-200"}`}>{t.label}</div>
              <div className={`text-xs mt-1 font-medium ${tier === t.id ? "text-purple-100" : "text-slate-400"}`}>{t.price}</div>
              <div className={`text-xs mt-2 ${tier === t.id ? "text-purple-200" : "text-slate-500"}`}>{t.videos}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Тип ролика */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-indigo-500 rounded-full" />
          <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Тип ролика</label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {VIDEO_TYPES.map((type) => (
            <button
              key={type.id}
              onClick={() => onUpdate({ videoType: type.id })}
              className={`p-4 rounded-2xl border text-left transition-all duration-200 group ${
                data.videoType === type.id
                  ? "border-purple-500 bg-gradient-to-br from-purple-600/20 to-indigo-600/20 text-white ring-1 ring-purple-500/40 shadow-lg shadow-purple-900/20"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-purple-500/40 hover:bg-white/8 backdrop-blur-sm"
              }`}
            >
              <div className="text-3xl mb-2 transition-transform duration-200 group-hover:scale-110">{type.emoji}</div>
              <div className="text-sm font-semibold">{type.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Название бренда */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-200">Название бренда</label>
        <input
          type="text"
          value={data.brandName}
          onChange={(e) => onUpdate({ brandName: e.target.value })}
          placeholder="например: Lumière Paris"
          className="w-full bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
        />
      </div>

      {/* Описание продукта */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-200">Что рекламируем?</label>
        <textarea
          value={data.productDescription}
          onChange={(e) => onUpdate({ productDescription: e.target.value })}
          placeholder="например: Люкс-сыворотка против старения с частицами золота 24К для женщин 35+"
          rows={3}
          className="w-full bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all resize-none"
        />
      </div>

      {/* Настроение */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 bg-gradient-to-b from-pink-500 to-purple-500 rounded-full" />
          <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Настроение ролика</label>
        </div>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((mood) => (
            <button
              key={mood}
              onClick={() => onUpdate({ mood })}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                data.mood === mood
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/30 ring-1 ring-purple-500/50"
                  : "bg-white/5 border border-white/10 text-slate-300 hover:border-purple-500/40 hover:text-white"
              }`}
            >
              {mood}
            </button>
          ))}
        </div>
      </div>

      {/* Платформа */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 bg-gradient-to-b from-cyan-500 to-blue-500 rounded-full" />
          <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Платформа <span className="text-slate-500 font-normal normal-case ml-1">(влияет на стиль и формат)</span>
          </label>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {[
            { id: "reels",    emoji: "📸", label: "Reels",       sub: "Instagram",      ar: "9:16" as const,  duration: "15-30" as const },
            { id: "tiktok",   emoji: "🎵", label: "TikTok",      sub: "TikTok",         ar: "9:16" as const,  duration: "15-30" as const },
            { id: "shorts",   emoji: "▶",  label: "Shorts",      sub: "YouTube",        ar: "9:16" as const,  duration: "15-30" as const },
            { id: "youtube",  emoji: "📺", label: "YouTube",     sub: "Ролик",          ar: "16:9" as const,  duration: "45-60" as const },
            { id: "telegram", emoji: "✈", label: "Telegram",    sub: "Канал",          ar: "9:16" as const,  duration: "15-30" as const },
            { id: "vk",       emoji: "🔵", label: "ВКонтакте",   sub: "VK Video",       ar: "9:16" as const,  duration: "30-45" as const },
            { id: "ads",      emoji: "📢", label: "Реклама",     sub: "Таргет/Директ",  ar: "9:16" as const,  duration: "15-30" as const },
            { id: "",         emoji: "⚙",  label: "Вручную",     sub: "Свои настройки", ar: "9:16" as const,  duration: "30-45" as const },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onUpdate({
                  platform: p.id,
                  ...(p.id && { aspectRatio: p.ar, videoDuration: p.duration }),
                });
              }}
              className={`p-3 rounded-xl border text-center transition-all duration-200 group ${
                data.platform === p.id
                  ? "border-cyan-500 bg-gradient-to-br from-cyan-600/20 to-blue-600/20 text-white ring-1 ring-cyan-500/30 shadow-md shadow-cyan-900/20"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8 backdrop-blur-sm"
              }`}
            >
              <div className="text-xl transition-transform duration-200 group-hover:scale-110">{p.emoji}</div>
              <div className="font-bold text-xs mt-1">{p.label}</div>
              <div className={`text-xs mt-0.5 ${data.platform === p.id ? "text-cyan-300" : "text-slate-600"}`}>{p.sub}</div>
            </button>
          ))}
        </div>
        {data.platform && data.platform !== "" && (
          <div className="bg-gradient-to-r from-slate-900/80 to-slate-800/60 border border-white/8 rounded-xl px-4 py-3 text-xs text-slate-400 space-y-1 backdrop-blur-sm">
            {data.platform === "reels" && <p>Reels: хук в первую секунду · 9:16 · 15–30 сек · быстрый монтаж</p>}
            {data.platform === "tiktok" && <p>TikTok: хук в первые 0.5 сек · нативный стиль · трендовая музыка</p>}
            {data.platform === "shorts" && <p>Shorts: хук 2–3 сек · работает без звука · зацикленный финал</p>}
            {data.platform === "youtube" && <p>YouTube: кинематограф 16:9 · медленный нарратив · 45–60 сек</p>}
            {data.platform === "telegram" && <p>Telegram: работает без звука · контентный, не агрессивный</p>}
            {data.platform === "vk" && <p>ВКонтакте: российская аудитория · стиль жизни · прямые преимущества</p>}
            {data.platform === "ads" && <p>Реклама: продукт в первые 3 сек · проблема→решение · чёткий CTA</p>}
            <p className="text-slate-600 font-medium">Формат: {data.aspectRatio} · Длина: {data.videoDuration}</p>
          </div>
        )}
      </div>

      {/* Формат — только в ручном режиме */}
      {(!data.platform || data.platform === "") && (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-200">Формат видео</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "9:16" as const, label: "9:16 Вертикаль", sub: "Reels / TikTok / Stories" },
              { value: "16:9" as const, label: "16:9 Горизонталь", sub: "YouTube / Кинотеатр" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdate({ aspectRatio: opt.value })}
                className={`p-4 rounded-xl border text-center transition-all duration-200 ${
                  data.aspectRatio === opt.value
                    ? "border-purple-500 bg-gradient-to-br from-purple-600/20 to-indigo-600/20 text-white ring-1 ring-purple-500/40"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                }`}
              >
                <div className="font-bold text-sm">{opt.label}</div>
                <div className={`text-xs mt-1 ${data.aspectRatio === opt.value ? "text-purple-300" : "text-slate-500"}`}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Длительность ролика */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full" />
          <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Длительность</label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => onUpdate({ videoDuration: d.value })}
              className={`p-4 rounded-2xl border text-center transition-all duration-200 relative ${
                data.videoDuration === d.value
                  ? "border-purple-500 bg-gradient-to-br from-purple-600/20 to-indigo-600/20 text-white ring-1 ring-purple-500/40 shadow-lg shadow-purple-900/20"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8"
              }`}
            >
              {d.tag && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap font-semibold shadow">
                  {d.tag}
                </div>
              )}
              <div className="font-bold text-sm mt-1">{d.label}</div>
              <div className="text-xs text-slate-500 mt-1">{d.scenes} {d.scenes === 1 ? "сцена" : "сцен"}</div>
              <div className={`text-xs mt-2 font-bold ${data.videoDuration === d.value ? "text-purple-300" : "text-slate-600"}`}>
                {d.cost}
              </div>
            </button>
          ))}
        </div>
        {data.videoDuration && (() => {
          const d = DURATIONS.find((x) => x.value === data.videoDuration)!;
          return (
            <div className="bg-gradient-to-r from-slate-900/80 to-slate-800/60 border border-white/8 rounded-xl px-5 py-4 flex items-center justify-between backdrop-blur-sm">
              <div className="text-sm text-slate-400">
                Итого за генерацию
                <span className="text-xs text-slate-600 block mt-0.5">
                  {d.value === "15-single"
                    ? "1 клип × $0.15 + кадр $0.04 (Seedance 2.0)"
                    : `${d.scenes} клипа × $0.15 (fal.ai)`}
                </span>
              </div>
              <span className="text-white font-black text-xl">{d.cost}</span>
            </div>
          );
        })()}
      </div>

      {/* ===== ПРО и выше ===== */}
      {tierGte(tier, "pro") && (
        <>
          {/* Целевая аудитория */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-200">Целевая аудитория</label>
            <input
              type="text"
              value={data.targetAudience}
              onChange={(e) => onUpdate({ targetAudience: e.target.value })}
              placeholder="Женщины 25–35, интересуются..."
              className="w-full bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            />
          </div>

          {/* Цвета бренда */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-200">
              Цвета бренда <span className="text-slate-500 font-normal">(необязательно)</span>
            </label>
            <input
              type="text"
              value={data.brandColors}
              onChange={(e) => onUpdate({ brandColors: e.target.value })}
              placeholder="золотой, чёрный, белый"
              className="w-full bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            />
          </div>

          {/* Авто-заполнение по сайту */}
          <div className="bg-gradient-to-br from-purple-950/60 to-indigo-950/40 border border-purple-500/25 rounded-2xl p-5 space-y-4 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 text-sm">AI</div>
              <span className="text-purple-300 font-bold text-sm">Авто-заполнение по сайту</span>
              <span className="text-xs text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full ml-auto">необязательно</span>
            </div>
            <p className="text-slate-400 text-sm">
              Введи URL своего сайта — AI проанализирует бренд и заполнит все поля автоматически
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={data.websiteUrl}
                onChange={(e) => onUpdate({ websiteUrl: e.target.value })}
                placeholder="https://your-brand.com"
                className="flex-1 bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all text-sm"
              />
              <button
                onClick={analyzeWebsite}
                disabled={!data.websiteUrl.trim() || analyzing}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 text-white font-semibold px-5 py-3 rounded-xl text-sm transition-all shadow-lg shadow-purple-900/30 whitespace-nowrap"
              >
                {analyzing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Анализирую...
                  </span>
                ) : "Анализировать"}
              </button>
            </div>
            <div>
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              >
                <span>{showApiKey ? "▾" : "▸"}</span>
                Firecrawl API key (для точного скрапинга)
              </button>
              {showApiKey && (
                <div className="mt-2 space-y-1">
                  <input
                    type="password"
                    value={firecrawlKey}
                    onChange={(e) => saveKey(e.target.value)}
                    placeholder="fc-... (получи бесплатно на firecrawl.dev)"
                    className="w-full bg-gray-900/80 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 text-xs"
                  />
                  <p className="text-xs text-slate-600">Без ключа работает через базовый парсинг. С ключом — точнее.</p>
                </div>
              )}
            </div>
            {analyzeError && <p className="text-red-400 text-sm">{analyzeError}</p>}
            {data.brandAnalysis && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 space-y-1">
                <p className="text-xs text-green-400 font-semibold">Анализ готов — поля заполнены</p>
                {data.brandAnalysis.videoAngle && (
                  <p className="text-xs text-slate-400">
                    <span className="text-slate-300">Угол для видео:</span> {data.brandAnalysis.videoAngle}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Логотип */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-1 h-5 bg-gradient-to-b from-cyan-500 to-teal-500 rounded-full" />
              <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Логотип <span className="text-slate-500 font-normal normal-case ml-1">(необязательно)</span>
              </label>
            </div>
            <ImageSlotCard
              slot="logo"
              inputRef={logoInputRef}
              photo={logoPhoto}
              idx={3}
              badge="@Image4"
              badgeColor="bg-cyan-600"
              label="Логотип бренда"
              hint="Появится в финальной сцене"
              req="PNG/SVG · прозрачный фон (без белого квадрата) · мин. 500×500px · макс. 5MB"
            />
            <div className="bg-cyan-950/30 border border-cyan-800/30 rounded-xl p-3 text-xs text-slate-400 space-y-1">
              <p className="text-cyan-400 font-semibold uppercase tracking-wide mb-2">Требования к логотипу</p>
              <p>✓ <span className="text-slate-300">Формат:</span> PNG или SVG</p>
              <p>✓ <span className="text-slate-300">Фон:</span> прозрачный (alpha-канал) — без белого квадрата</p>
              <p>✓ <span className="text-slate-300">Размер:</span> минимум 500×500px, идеально 1000×1000px+</p>
              <p>✓ <span className="text-slate-300">Вес файла:</span> до 5MB</p>
              <p className="text-slate-500 pt-1">Нет PNG с прозрачным фоном? Нажми &quot;Убрать фон&quot; — сделаем автоматически</p>
            </div>
          </div>
        </>
      )}

      {/* ===== ПРОФИ и выше ===== */}
      {true && (
        <>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full" />
              <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Фото продукта <span className="text-slate-500 font-normal normal-case ml-1">(резко повышает качество)</span>
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Seedance 2.0 вставит твои фото напрямую в ролик как @Image1–@Image3
            </p>

            {/* Авто-генерация ассетов */}
            {data.productDescription && data.targetAudience && data.mood && (
              <div className="bg-gradient-to-br from-purple-950/60 to-pink-950/30 border border-purple-500/25 rounded-2xl p-4 space-y-3 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-purple-300">Авто-генерировать ассеты без фото</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      AI создаст реалистичного героя (Midjourney v7) и продукт (Recraft V3) по бриф-данным
                    </p>
                  </div>
                  <button
                    onClick={autoGenerateAssets}
                    disabled={autoGenerating}
                    className="shrink-0 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-md whitespace-nowrap"
                  >
                    {autoGenerating ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ~2–3 мин...
                      </span>
                    ) : "Генерировать"}
                  </button>
                </div>
                {heroProfile && (
                  <div className="bg-white/5 rounded-xl px-3 py-2.5 space-y-1 border border-white/8">
                    <p className="text-xs text-slate-400 font-semibold">Профиль героя:</p>
                    <p className="text-xs text-white font-medium">
                      {heroProfile.gender === "female" ? "Женщина" : "Мужчина"}, {heroProfile.age}
                    </p>
                    <p className="text-xs text-slate-400">{heroProfile.style}</p>
                  </div>
                )}
                {heroVariants.length > 1 && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300 font-semibold">Выбери лучшего героя (Midjourney v7):</p>
                    <div className="grid grid-cols-2 gap-2">
                      {heroVariants.map((url, i) => (
                        <button
                          key={url}
                          onClick={() => selectHeroVariant(url)}
                          className="relative group rounded-xl overflow-hidden border-2 border-white/10 hover:border-purple-500 transition-all aspect-[2/3] shadow-lg"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Вариант ${i + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                            <span className="text-white text-xs font-bold bg-purple-600 px-3 py-1 rounded-full">Выбрать</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {autoGenError && <p className="text-red-400 text-xs">{autoGenError}</p>}
              </div>
            )}

            <ImageSlotCard
              slot="hero"
              inputRef={heroInputRef}
              photo={heroPhoto}
              idx={0}
              badge="@Image1"
              badgeColor="bg-purple-600"
              label="Герой / Модель"
              hint="Человек в полный рост или коллаж лицо+тело"
              req="Чёткое фото на нейтральном фоне, мин. 1024px"
            />
            <ImageSlotCard
              slot="product"
              inputRef={productInputRef}
              photo={productPhoto}
              idx={1}
              badge="@Image2"
              badgeColor="bg-indigo-600"
              label="Продукт (спереди)"
              hint="Главный рекламируемый товар, вид спереди"
              req="Белый/нейтральный фон, мин. 1024px, равномерный свет"
            />
            <ImageSlotCard
              slot="product-back"
              inputRef={productBackInputRef}
              photo={productBackPhoto}
              idx={2}
              badge="@Image3"
              badgeColor="bg-blue-600"
              label="Продукт (сзади/деталь)"
              hint="Второй ракурс, деталь, вид сзади — необязательно"
              req="Тот же товар с другого угла"
            />

            {imageError && <p className="text-red-400 text-sm">{imageError}</p>}

            {data.uploadedImages.filter(Boolean).length >= 1 && (
              <div className="space-y-2">
                <button
                  onClick={extractBrandDNA}
                  disabled={extractingDNA}
                  className="w-full bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 hover:border-purple-500/40 text-slate-300 hover:text-white text-sm font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {extractingDNA ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      Gemini Vision читает DNA бренда...
                    </>
                  ) : (
                    <>
                      <span className="text-purple-400">◈</span>
                      Извлечь DNA бренда — авто-заполнить цвета и стиль
                    </>
                  )}
                </button>
                {dnaError && <p className="text-red-400 text-xs">{dnaError}</p>}
              </div>
            )}
          </div>

          {/* Видео-референс + YouTube анализ */}
          <VideoReferenceUpload
            currentAnalysis={data.videoReference}
            currentUrl={data.videoReferenceUrl}
            brandName={data.brandName}
            niche={data.videoType}
            onAnalysis={(analysis, url) => onUpdate({ videoReference: analysis, videoReferenceUrl: url })}
            onScriptImport={(scenes, _style, mood) => {
              // Импортируем сценарий из YouTube — пропускаем генерацию на шаге 2
              onUpdate({
                script: scenes.map((s) => ({
                  sceneNumber: s.sceneNumber,
                  duration: s.duration,
                  description: s.description,
                  descriptionRu: s.descriptionRu,
                  visualPrompt: s.visualPrompt,
                  cameraMovement: s.cameraMovement,
                  sceneType: s.sceneType as "nature" | "product" | "face" | "action" | "logo" | "unknown",
                })),
                mood: mood || data.mood,
              });
            }}
          />

          {/* Режиссёрское видение */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-200">
              Режиссёрское видение <span className="text-slate-500 font-normal">(необязательно)</span>
            </label>
            <textarea
              value={data.directorVision}
              onChange={(e) => onUpdate({ directorVision: e.target.value })}
              placeholder="Опиши своими словами что хочешь видеть..."
              rows={3}
              className="w-full bg-gray-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all resize-none"
            />
          </div>
        </>
      )}

      {/* ===== СТУДИЯ ===== */}
      {tierGte(tier, "studio") && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 bg-gradient-to-b from-amber-500 to-yellow-500 rounded-full" />
            <label className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Все ассеты</label>
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full font-bold">Студия</span>
          </div>
          <p className="text-xs text-slate-500">
            Все 6 слотов для максимального контроля над роликом (@Image1–@Image6)
          </p>

          <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/40 border border-white/8 rounded-2xl p-5 space-y-4 backdrop-blur-sm">
            <p className="text-xs font-bold text-slate-300 uppercase tracking-wide">Требования к фото</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-400">
              <div className="space-y-2">
                <p className="text-slate-200 font-semibold">Герой / Модель (@Image1)</p>
                <ul className="space-y-1 text-slate-500">
                  <li>· Белый или нейтральный фон, без теней</li>
                  <li>· Полный рост или поясной портрет</li>
                  <li>· Резкость на лице, чёткие черты</li>
                  <li>· Минимум 1024 × 1024 px</li>
                </ul>
              </div>
              <div className="space-y-2">
                <p className="text-slate-200 font-semibold">Продукт (@Image2–3)</p>
                <ul className="space-y-1 text-slate-500">
                  <li>· Белый фон, равномерный студийный свет</li>
                  <li>· Без бликов, без теней</li>
                  <li>· Спереди + дополнительный ракурс</li>
                  <li>· Минимум 1024 × 1024 px</li>
                </ul>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3">
              <p className="text-xs text-indigo-300">
                Каждый слот оценивается AI автоматически. A (85+/100) — идеально. B (70+) — приемлемо. C/F — замени фото.
              </p>
            </div>
          </div>

          <ImageSlotCard
            slot="product-item"
            inputRef={productItemInputRef}
            photo={productItemPhoto}
            idx={4}
            badge="@Image5"
            badgeColor="bg-teal-600"
            label="Доп. товар / аксессуар"
            hint="Напиток, упаковка, аксессуар — если нужен"
            req="Необязательно"
          />
          <ImageSlotCard
            slot="partner-logo"
            inputRef={partnerLogoInputRef}
            photo={partnerLogoPhoto}
            idx={5}
            badge="@Image6"
            badgeColor="bg-slate-600"
            label="Логотип партнёра"
            hint="Второй лого, если нужно два бренда"
            req="Необязательно"
          />

          {imageError && <p className="text-red-400 text-sm">{imageError}</p>}

          {/* MJ Hero Collage */}
          <div className="bg-gradient-to-br from-purple-950/60 to-indigo-950/40 border border-purple-500/25 rounded-2xl p-5 space-y-3 backdrop-blur-sm">
            <p className="text-sm font-bold text-purple-300">Сгенерировать героя MidJourney</p>
            <p className="text-xs text-slate-400">
              MJ v7 --cref коллаж для стабильного лица героя во всех сценах ролика
            </p>
            {heroPhoto ? (
              <button
                onClick={() => setShowCollageModal(true)}
                className="w-full bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/40 hover:border-purple-500/70 text-purple-300 text-sm font-semibold py-3 px-4 rounded-xl transition-all"
              >
                {data.heroCollageUrl ? "Пересоздать Hero Collage" : "Создать Hero Collage (MJ v7 --cref)"}
              </button>
            ) : (
              <p className="text-xs text-slate-500">Сначала загрузи фото героя в слот @Image1 (блок Профи)</p>
            )}
            {data.heroCollageUrl && (
              <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.heroCollageUrl} alt="Hero collage" className="w-14 h-14 object-cover rounded-lg border border-purple-500/30" />
                <p className="text-xs text-green-400 font-medium">Коллаж создан — лицо героя стабилизировано</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Умные вопросы от ИИ */}
      <div className="space-y-3">
        <button
          onClick={fetchSmartQuestions}
          disabled={loadingQuestions}
          className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-purple-500/40 text-slate-300 hover:text-white font-medium py-3 rounded-xl text-sm transition-all disabled:opacity-50"
        >
          {loadingQuestions ? (
            <>
              <span className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              ИИ думает над вопросами...
            </>
          ) : (
            <>
              <span>💡</span>
              Помогите ИИ задать умные вопросы для лучшего результата
            </>
          )}
        </button>

        {showQuestions && smartQuestions.length > 0 && (
          <div className="bg-purple-500/8 border border-purple-500/20 rounded-xl p-4 space-y-3">
            <p className="text-xs text-purple-300 font-medium uppercase tracking-wider">
              Ответьте в поле &quot;Режиссёрское видение&quot; ниже ↓
            </p>
            <ol className="space-y-2">
              {smartQuestions.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-purple-400 font-bold shrink-0">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Сохранить как бренд — если брендов нет, форма заполнена */}
      {savedBrands.length === 0 && !brandsLoading && data.brandName.trim() && (
        <div className="flex items-center gap-3">
          <button
            onClick={saveBrandKit}
            className="text-xs text-slate-400 hover:text-slate-200 border border-white/10 hover:border-purple-500/40 px-4 py-2 rounded-lg transition-all"
          >
            Сохранить как бренд
          </button>
          {brandSavedToast && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span>✓</span> Бренд сохранён
            </span>
          )}
        </div>
      )}

      {/* Кнопка Далее */}
      <button
        onClick={onNext}
        disabled={!isValid}
        className="w-full relative bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:via-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-lg transition-all duration-300 shadow-xl shadow-purple-900/40 hover:shadow-purple-900/60 hover:scale-[1.01] active:scale-[0.99]"
        style={{ backgroundSize: "200% auto" }}
      >
        Сгенерировать сценарий
      </button>

      {showCollageModal && heroPhoto && (
        <HeroCollageModal
          brandName={data.brandName}
          mood={data.mood}
          productDescription={data.productDescription}
          videoType={data.videoType}
          heroImageUrl={heroPhoto}
          onSelect={(url) => {
            const updated = [...data.uploadedImages];
            updated[0] = url;
            onUpdate({ uploadedImages: updated, heroCollageUrl: url });
          }}
          onClose={() => setShowCollageModal(false)}
        />
      )}
    </div>
  );
}
