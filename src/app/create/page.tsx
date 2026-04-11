"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { WizardStep } from "@/components/wizard/WizardStep";
import { StepBrief } from "@/components/wizard/StepBrief";
import { StepScript } from "@/components/wizard/StepScript";
import { StepFrames } from "@/components/wizard/StepFrames";
import { StepVideo } from "@/components/wizard/StepVideo";
import { StepResult } from "@/components/wizard/StepResult";

const STEPS = [
  { id: 1, label: "Бриф" },
  { id: 2, label: "Сценарий" },
  { id: 3, label: "Кадры" },
  { id: 4, label: "Видео" },
  { id: 5, label: "Результат" },
];

export type BrandAnalysis = {
  keyPains: string[];
  keyDesires: string[];
  emotionalTriggers: string[];
  videoAngle: string;
  toneOfVoice: string;
  callToAction: string;
};

export type VideoDuration = "15-single" | "15-30" | "30-45" | "45-60";

export type ProjectData = {
  tier: "start" | "pro" | "profi" | "studio";
  websiteUrl: string;
  brandAnalysis: BrandAnalysis | null;
  videoType: string;
  brandName: string;
  brandColors: string;
  mood: string;
  targetAudience: string;
  productDescription: string;
  platform: string;
  videoDuration: VideoDuration;
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  directorVision: string;
  uploadedImages: string[];
  imageScores: (null | { score: number; grade: string; feedback: string; tips: string[] })[];
  heroCollageUrl: string | null;
  keyframeVariants: string[][];
  videoReferenceUrl: string;
  videoReference: import("@/app/api/analyze/video-reference/route").VideoAnalysis | null;
  script: SceneScript[] | null;
  keyframes: string[];
  selectedFrames: number[];
  videoClips: string[];
  selectedClips: number[];
  videoVariants: Record<number, string[]>; // sceneIndex → массив URL вариантов
  musicUrl: string | null;
  voiceoverScript: string;
  voiceoverUrl: string | null;
  voiceoverId: string;
  burnSubtitles: boolean;
};

export type SceneScript = {
  sceneNumber: number;
  duration: string;
  description: string;
  descriptionRu?: string;
  visualPrompt: string;
  cameraMovement: string;
  sceneType?: "nature" | "product" | "face" | "action" | "logo" | "unknown";
};

const initialData: ProjectData = {
  tier: "pro",
  websiteUrl: "",
  brandAnalysis: null,
  videoType: "",
  brandName: "",
  brandColors: "",
  mood: "",
  targetAudience: "",
  productDescription: "",
  platform: "",
  videoDuration: "30-45",
  aspectRatio: "9:16",
  directorVision: "",
  uploadedImages: [],
  imageScores: [],
  heroCollageUrl: null,
  keyframeVariants: [],
  videoReferenceUrl: "",
  videoReference: null,
  script: null,
  keyframes: [],
  selectedFrames: [],
  videoClips: [],
  selectedClips: [],
  videoVariants: {},
  musicUrl: null,
  voiceoverScript: "",
  voiceoverUrl: null,
  voiceoverId: "pNInz6obpgDQGcFmaJgB",
  burnSubtitles: false,
};

const LS_WIZARD_KEY = "vf_wizard_draft_v1";

// Сохраняем только brief поля — не генерированный контент (кадры, клипы и т.д.)
function saveDraftToLS(data: ProjectData, step: number) {
  try {
    const draft = {
      step,
      savedAt: Date.now(),
      brandName: data.brandName,
      brandColors: data.brandColors,
      websiteUrl: data.websiteUrl,
      videoType: data.videoType,
      mood: data.mood,
      targetAudience: data.targetAudience,
      productDescription: data.productDescription,
      platform: data.platform,
      videoDuration: data.videoDuration,
      aspectRatio: data.aspectRatio,
      directorVision: data.directorVision,
      tier: data.tier,
    };
    localStorage.setItem(LS_WIZARD_KEY, JSON.stringify(draft));
  } catch {}
}

function loadDraftFromLS(): { step: number; data: Partial<ProjectData> } | null {
  try {
    const raw = localStorage.getItem(LS_WIZARD_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_WIZARD_KEY);
      return null;
    }
    const { step, savedAt: _savedAt, ...rest } = draft;
    return { step: step ?? 1, data: rest };
  } catch {
    return null;
  }
}

export default function CreatePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<ProjectData>(initialData);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("unsaved");
  const [loadingProject, setLoadingProject] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const saveProject = useCallback(async (newData: ProjectData, step: number) => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setSaveStatus("unsaved"); return; }
    setSaveStatus("saving");
    try {
      if (projectId) {
        const putRes = await fetch(`/api/projects?id=${projectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: newData, currentStep: step, brandName: newData.brandName }),
        });
        if (!putRes.ok) throw new Error("Save failed");
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: newData, currentStep: step, brandName: newData.brandName }),
        });
        const json = await res.json();
        if (json.id) {
          setProjectId(json.id);
          window.history.replaceState({}, "", `/create?id=${json.id}`);
        }
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    }
  }, [projectId]);

  const updateData = (updates: Partial<ProjectData>) => {
    setData((prev) => {
      const next = { ...prev, ...updates };
      // Быстрый localStorage fallback (работает без Supabase)
      saveDraftToLS(next, currentStep);
      // Debounced Supabase save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveProject(next, currentStep), 2000);
      return next;
    });
  };

  // Сохраняем шаг в localStorage при переключении
  const goNext = () => setCurrentStep((s) => {
    const next = Math.min(s + 1, 5);
    saveDraftToLS(data, next);
    return next;
  });
  const goPrev = () => setCurrentStep((s) => {
    const next = Math.max(s - 1, 1);
    saveDraftToLS(data, next);
    return next;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (id) {
      // Загружаем из Supabase по ID
      setLoadingProject(true);
      fetch(`/api/projects?id=${id}`)
        .then((r) => r.json())
        .then((project) => {
          if (project.data) {
            setData({ ...initialData, ...project.data });
            setCurrentStep(project.current_step ?? 1);
            setProjectId(id);
            setSaveStatus("saved");
          }
        })
        .catch(() => {})
        .finally(() => setLoadingProject(false));
    } else {
      // Нет ID — пробуем восстановить из localStorage
      const draft = loadDraftFromLS();
      if (draft) {
        setData((prev) => ({ ...prev, ...draft.data }));
        setCurrentStep(draft.step);
      }
    }
  }, []);


  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-purple-300">AI Video Factory</span>
            <div className="flex items-center gap-3">
              {projectId && (
                <span className="text-xs text-slate-500">
                  {saveStatus === "saving" ? "Сохраняю..." : saveStatus === "saved" ? "✓ Сохранено" : ""}
                </span>
              )}
              <span className="text-slate-400 text-sm">
                Шаг {currentStep} из {STEPS.length} — {STEPS[currentStep - 1].label}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {STEPS.map((step) => (
              <WizardStep
                key={step.id}
                step={step}
                currentStep={currentStep}
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
              />
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {loadingProject ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            Загрузка проекта...
          </div>
        ) : null}
        {!loadingProject && currentStep === 1 && (
          <StepBrief data={data} onUpdate={updateData} onNext={goNext} />
        )}
        {!loadingProject && currentStep === 2 && (
          <StepScript data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {!loadingProject && currentStep === 3 && (
          <StepFrames data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {!loadingProject && currentStep === 4 && (
          <StepVideo data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {!loadingProject && currentStep === 5 && (
          <StepResult data={data} onPrev={goPrev} />
        )}
      </main>
    </div>
  );
}
