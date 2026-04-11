"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ProjectData } from "@/app/create/page";
import { VoiceoverSection } from "@/components/wizard/VoiceoverSection";

type Props = {
  data: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  onNext: () => void;
  onPrev: () => void;
};

type SceneJob = {
  index: number;       // индекс сцены в массиве (0-based)
  sceneNumber: number; // номер сцены (1-based)
  variantIndex: number; // 0..N-1
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  status_url?: string;
  response_url?: string;
  videoUrl?: string;
  error?: string;
  retries: number;
};

type SavedSession = {
  jobs: SceneJob[];
  mood: string;
  savedAt: number;
};

const STATUS_LABEL: Record<SceneJob["status"], string> = {
  IN_QUEUE: "В очереди...",
  IN_PROGRESS: "Генерируется...",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
};

const STATUS_COLOR: Record<SceneJob["status"], string> = {
  IN_QUEUE: "text-slate-400",
  IN_PROGRESS: "text-yellow-400",
  COMPLETED: "text-green-400",
  FAILED: "text-red-400",
};

const MAX_RETRIES = 2;
const POLL_INTERVAL_MS = 6000;
const MAX_POLL_MS = 12 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 20 * 60 * 1000;
const LS_KEY = "vf_video_session_v2";

const COST_PER_SCENE_USD = 0.15;

type BalanceShorthand = {
  balance: number | null;
  available: boolean;
  currency: "USD";
};

type BalanceData = {
  atlas: BalanceShorthand;
  fal:   BalanceShorthand;
};

function estimateCost(sceneCount: number): number {
  return sceneCount * COST_PER_SCENE_USD;
}

function fetchWithTimeout(url: string, options: RequestInit = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function saveSession(jobs: SceneJob[], mood: string) {
  try {
    const session: SavedSession = { jobs, mood, savedAt: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(session));
  } catch {}
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const session: SavedSession = JSON.parse(raw);
    if (
      !session ||
      typeof session.savedAt !== "number" ||
      !Array.isArray(session.jobs) ||
      Date.now() - session.savedAt > SESSION_TTL_MS
    ) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function clearSession() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

function buildSunoPrompt(data: ProjectData): string {
  const moodMap: Record<string, string> = {
    "Люкс":               "cinematic luxury, orchestral swells, deep bass, elegant piano",
    "Энергия":            "energetic electronic, driving beat, synth pulse, uplifting",
    "Мягко и натурально": "soft acoustic, warm guitar, gentle piano, airy and calm",
    "Дерзко":             "bold hip-hop, punchy 808s, confident rap energy",
    "Минимализм":         "minimal electronic, clean beats, subtle textures, modern",
    "Игриво":             "playful pop, bright synths, fun rhythm, catchy hooks",
  };
  const base = moodMap[data.mood] ?? "cinematic commercial, emotional, brand soundtrack";
  const refKeywords = data.videoReference?.moodKeywords?.join(", ");
  const refCamera = data.videoReference?.pacing
    ? `, ${data.videoReference.pacing.includes("slow") ? "slow tempo 80-90 bpm" : "medium tempo 100-120 bpm"}`
    : "";
  const brandNote = data.brandName ? `, ${data.brandName} brand identity` : "";
  return `${base}${refCamera}${brandNote}${refKeywords ? `, ${refKeywords}` : ""}, no lyrics, 30 seconds`;
}

function MusicSection({ data, onUpdate }: { data: ProjectData; onUpdate: (u: Partial<ProjectData>) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const sunoPrompt = buildSunoPrompt(data);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(sunoPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-300 font-medium text-sm">Фоновая музыка</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">необязательно</span>
          {data.musicUrl && <span className="text-xs text-green-400">Добавлена</span>}
        </div>
        <span className="text-slate-500 text-sm">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">Suno промт (сгенерирован под твой стиль)</p>
            <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3 text-xs text-slate-300 font-mono leading-relaxed">
              {sunoPrompt}
            </div>
            {data.videoReference && (
              <p className="text-xs text-purple-400">
                Учтён стиль видео-референса: {data.videoReference.moodKeywords?.slice(0, 3).join(", ")}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={copyPrompt}
                className="flex-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-xs font-medium py-2 rounded-lg transition-colors"
              >
                {copied ? "Скопировано!" : "Копировать промт"}
              </button>
              <a
                href="https://suno.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-medium py-2 rounded-lg transition-colors text-center"
              >
                Открыть Suno →
              </a>
            </div>
            <p className="text-xs text-slate-600">Вставь промт в Suno, скачай mp3, вставь ссылку ниже</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">URL аудио файла</p>
            <input
              type="url"
              value={data.musicUrl ?? ""}
              onChange={(e) => onUpdate({ musicUrl: e.target.value || null })}
              placeholder="https://cdn.suno.ai/... или любой mp3 URL"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

type AtlasErrorState = {
  reason: string;
  estimatedWaitMinutes: number;
  fallbackAvailable: boolean;
  fallbackModel: string;
};

export function StepVideo({ data, onUpdate, onNext, onPrev }: Props) {
  const [submitLoading, setSubmitLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atlasError, setAtlasError] = useState<AtlasErrorState | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [jobs, setJobs] = useState<SceneJob[]>([]);
  const [restoredSession, setRestoredSession] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);

  // Варианты на сцену: 1 (default), 2 или 3
  const [variantsCount, setVariantsCount] = useState(1);
  // sceneIndex -> массив URL вариантов (накапливается по мере готовности)
  const [sceneVariants, setSceneVariants] = useState<Record<number, string[]>>({});
  // sceneIndex -> выбранный индекс варианта (0-based)
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});

  const jobsRef = useRef<SceneJob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const moodRef = useRef(data.mood);
  moodRef.current = data.mood;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const variantsCountRef = useRef(variantsCount);
  variantsCountRef.current = variantsCount;

  const selectedFrameUrls = data.selectedFrames.map((i) => data.keyframes[i]).filter(Boolean) as string[];
  const filteredScript = data.script?.filter((_, i) => data.selectedFrames.includes(i)) ?? [];
  const limitedScript = testMode ? filteredScript.slice(0, 1) : filteredScript;
  const limitedFrames = testMode ? selectedFrameUrls.slice(0, 1) : selectedFrameUrls;

  const limitedScriptRef = useRef(limitedScript);
  limitedScriptRef.current = limitedScript;
  const limitedFramesRef = useRef(limitedFrames);
  limitedFramesRef.current = limitedFrames;
  const brandImagesRef = useRef(data.uploadedImages ?? []);
  brandImagesRef.current = data.uploadedImages ?? [];
  const aspectRatioRef = useRef(data.aspectRatio ?? "9:16");
  aspectRatioRef.current = data.aspectRatio ?? "9:16";
  const brandNameRef = useRef(data.brandName ?? "");
  brandNameRef.current = data.brandName ?? "";

  // Уникальный ключ джоба: сцена + вариант
  const jobKey = (index: number, variantIndex: number) => `${index}_${variantIndex}`;

  const syncJobByKey = useCallback((index: number, variantIndex: number, updates: Partial<SceneJob>) => {
    setJobs((prev) => {
      const next = prev.map((j) =>
        j.index === index && j.variantIndex === variantIndex ? { ...j, ...updates } : j
      );
      jobsRef.current = next;
      saveSession(next, moodRef.current);
      return next;
    });
  }, []);

  // Обратная совместимость для retry (variantsCount=1, variantIndex=0)
  const syncJob = useCallback((index: number, updates: Partial<SceneJob>) => {
    syncJobByKey(index, 0, updates);
  }, [syncJobByKey]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const retryJob = useCallback(async (job: SceneJob) => {
    const scene = limitedScriptRef.current[job.index];
    const frame = limitedFramesRef.current[job.index];
    if (!scene || !frame) {
      syncJob(job.index, { status: "FAILED", error: "Нет данных для повтора" });
      return;
    }
    console.log(`[StepVideo] retry scene ${job.sceneNumber}, attempt ${job.retries + 1}`);
    try {
      const res = await fetchWithTimeout("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: [scene],
          keyframes: [frame],
          mood: moodRef.current,
          brandName: brandNameRef.current,
          aspectRatio: aspectRatioRef.current ?? "9:16",
          brandImages: brandImagesRef.current,
          variantsCount: 1,
        }),
      }, 30_000);

      if (!res.ok) throw new Error("Submit failed");
      const { scenes } = await res.json();
      const s = scenes[0];

      if (s?.status_url) {
        syncJobByKey(job.index, job.variantIndex, {
          status: "IN_QUEUE",
          status_url: s.status_url,
          response_url: s.response_url,
          error: undefined,
        });
      } else {
        syncJobByKey(job.index, job.variantIndex, { status: "FAILED", error: s?.error ?? "Повтор не удался" });
      }
    } catch (e) {
      syncJobByKey(job.index, job.variantIndex, {
        status: "FAILED",
        error: e instanceof Error ? e.message : "Повтор не удался",
      });
    }
  }, [syncJob, syncJobByKey]);

  // Финализация после всех джобов: строим videoClips/videoVariants
  const finalizeJobs = useCallback((current: SceneJob[]) => {
    const vc = variantsCountRef.current;
    if (vc <= 1) {
      // Обратная совместимость: просто массив URL
      const done = current.filter((j) => j.status === "COMPLETED" && j.videoUrl);
      if (done.length > 0) {
        clearSession();
        onUpdateRef.current({
          videoClips: done.map((j) => j.videoUrl!),
          selectedClips: done.map((_, i) => i),
          videoVariants: {},
        });
        setTimeout(() => { jobsRef.current = []; setJobs([]); }, 100);
      }
    } else {
      // Несколько вариантов: группируем по sceneIndex
      const byScene: Record<number, string[]> = {};
      for (const j of current) {
        if (j.status === "COMPLETED" && j.videoUrl) {
          if (!byScene[j.index]) byScene[j.index] = [];
          byScene[j.index][j.variantIndex] = j.videoUrl;
        }
      }
      // Фильтруем пустые
      const cleanByScene: Record<number, string[]> = {};
      for (const [si, variants] of Object.entries(byScene)) {
        const filtered = variants.filter(Boolean);
        if (filtered.length > 0) cleanByScene[Number(si)] = filtered;
      }

      if (Object.keys(cleanByScene).length > 0) {
        clearSession();
        // videoClips = первый вариант каждой сцены как дефолт
        const sceneIndices = Object.keys(cleanByScene).map(Number).sort((a, b) => a - b);
        const defaultClips = sceneIndices.map((si) => cleanByScene[si][0]);

        setSceneVariants(cleanByScene);
        setSelectedVariants(Object.fromEntries(sceneIndices.map((si) => [si, 0])));

        onUpdateRef.current({
          videoClips: defaultClips,
          selectedClips: defaultClips.map((_, i) => i),
          videoVariants: cleanByScene,
        });
        setTimeout(() => { jobsRef.current = []; setJobs([]); }, 100);
      }
    }
  }, []);

  const tick = useCallback(async () => {
    const current = jobsRef.current;
    const pending = current.filter((j) => j.status === "IN_QUEUE" || j.status === "IN_PROGRESS");

    if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
      pending.forEach((job) =>
        syncJobByKey(job.index, job.variantIndex, { status: "FAILED", error: "Превышено время ожидания" })
      );
      stopPolling();
      return;
    }

    if (pending.length === 0) {
      stopPolling();
      finalizeJobs(current);
      return;
    }

    await Promise.allSettled(
      pending.map(async (job) => {
        if (!job.status_url || !job.response_url) return;
        try {
          const res = await fetchWithTimeout(
            `/api/generate/video/status?statusUrl=${encodeURIComponent(job.status_url)}&responseUrl=${encodeURIComponent(job.response_url)}`
          );
          if (!res.ok) return;

          const d = await res.json();

          if (d.status === "COMPLETED" && d.videoUrl) {
            syncJobByKey(job.index, job.variantIndex, { status: "COMPLETED", videoUrl: d.videoUrl });
            return;
          }

          const isFailed = d.status === "FAILED" || d.status === "COMPLETED_NO_URL";
          if (isFailed && job.retries < MAX_RETRIES) {
            syncJobByKey(job.index, job.variantIndex, { retries: job.retries + 1, status: "IN_QUEUE" });
            await retryJob({ ...job, retries: job.retries + 1 });
          } else if (isFailed) {
            syncJobByKey(job.index, job.variantIndex, {
              status: "FAILED",
              error: d.error ?? "Не удалось после нескольких попыток",
            });
          } else {
            syncJobByKey(job.index, job.variantIndex, { status: d.status });
          }
        } catch {
          // AbortError или сетевая ошибка — продолжаем опрашивать
        }
      })
    );
  }, [stopPolling, syncJobByKey, retryJob, finalizeJobs]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStartRef.current = Date.now();
    setIsPolling(true);
    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);
  }, [stopPolling, tick]);

  const startPollingRef = useRef(startPolling);
  useEffect(() => { startPollingRef.current = startPolling; }, [startPolling]);

  // Восстановление сессии при монтировании
  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    const hasPending = session.jobs.some(
      (j) => j.status === "IN_QUEUE" || j.status === "IN_PROGRESS"
    );
    if (hasPending) {
      jobsRef.current = session.jobs;
      setJobs(session.jobs);
      setRestoredSession(true);
      startPollingRef.current();
    } else {
      const done = session.jobs.filter((j) => j.status === "COMPLETED" && j.videoUrl);
      if (done.length > 0) {
        jobsRef.current = session.jobs;
        setJobs(session.jobs);
      }
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Fetch балансов при монтировании
  useEffect(() => {
    let cancelled = false;
    fetch("/api/balances")
      .then((r) => r.json())
      .then((d: { atlas?: BalanceShorthand; fal?: BalanceShorthand }) => {
        if (cancelled) return;
        if (d.atlas && d.fal) {
          setBalanceData({ atlas: d.atlas, fal: d.fal });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const generateVideo = async (forceProvider?: "fal") => {
    if (!data.script) return;
    stopPolling();
    clearSession();
    setJobs([]);
    jobsRef.current = [];
    setError(null);
    setAtlasError(null);
    setRestoredSession(false);
    setSceneVariants({});
    setSelectedVariants({});
    setSubmitLoading(true);

    try {
      const res = await fetchWithTimeout(
        "/api/generate/video",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            script: limitedScript,
            keyframes: limitedFrames,
            mood: data.mood,
            brandName: data.brandName,
            aspectRatio: data.aspectRatio ?? "9:16",
            brandImages: data.uploadedImages ?? [],
            variantsCount,
            ...(forceProvider ? { forceProvider } : {}),
          }),
        },
        60_000
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Ошибка сервера" }));
        if (errData.atlasDown) {
          setAtlasError({
            reason: errData.reason ?? "all_retries_failed",
            estimatedWaitMinutes: errData.estimatedWaitMinutes ?? 2,
            fallbackAvailable: errData.fallbackAvailable ?? false,
            fallbackModel: errData.fallbackModel ?? "fal.ai",
          });
          return;
        }
        throw new Error(errData.error ?? "Ошибка отправки");
      }

      const responseData = (await res.json()) as {
        scenes: Array<{
          index: number;
          sceneNumber: number;
          variantIndex?: number;
          status_url?: string;
          response_url?: string;
          error?: string;
        }>;
        variantsCount?: number;
        model?: string;
      };
      const { scenes } = responseData;
      if (responseData.model) setActiveModel(responseData.model);

      const initialJobs: SceneJob[] = scenes.map((s) => ({
        index: s.index,
        sceneNumber: s.sceneNumber,
        variantIndex: s.variantIndex ?? 0,
        status: s.error ? "FAILED" : "IN_QUEUE",
        status_url: s.status_url,
        response_url: s.response_url,
        error: s.error,
        retries: 0,
      }));

      jobsRef.current = initialJobs;
      setJobs(initialJobs);
      saveSession(initialJobs, data.mood);
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setSubmitLoading(false);
    }
  };

  const startGenerationWithFallback = () => generateVideo("fal");

  const toggleClip = (i: number) => {
    const next = data.selectedClips.includes(i)
      ? data.selectedClips.filter((x) => x !== i)
      : [...data.selectedClips, i];
    onUpdate({ selectedClips: next });
  };

  // Выбор варианта для сцены — обновляет videoClips[sceneIndex]
  const selectVariant = (sceneIndex: number, variantIdx: number) => {
    const variants = sceneVariants[sceneIndex];
    if (!variants || !variants[variantIdx]) return;
    const url = variants[variantIdx];

    setSelectedVariants((prev) => ({ ...prev, [sceneIndex]: variantIdx }));

    const newClips = [...data.videoClips];
    // Находим позицию этой сцены в массиве клипов
    const sortedSceneIndices = Object.keys(sceneVariants).map(Number).sort((a, b) => a - b);
    const clipPos = sortedSceneIndices.indexOf(sceneIndex);
    if (clipPos >= 0) {
      newClips[clipPos] = url;
      onUpdate({ videoClips: newClips });
    }
  };

  const allDone =
    jobs.length > 0 && jobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED");
  const allFailed =
    jobs.length > 0 && jobs.every((j) => j.status === "FAILED") && !isPolling;
  const isActive = submitLoading || isPolling;

  // Считаем прогресс по уникальным сценам (не по вариантам)
  const uniqueSceneCount = new Set(jobs.map((j) => j.index)).size;
  const completedJobsCount = jobs.filter((j) => j.status === "COMPLETED").length;
  const totalJobsCount = jobs.length;
  const secPerScene = activeModel === "seedance-2.0" ? 35 : 25;
  const remainingJobs = totalJobsCount - jobs.filter((j) => j.status === "COMPLETED" || j.status === "FAILED").length;
  const etaMin = Math.ceil((remainingJobs * secPerScene) / 60);

  // Стоимость с учётом вариантов
  const totalCost = estimateCost(limitedFrames.length * variantsCount);

  // Группировка джобов по сцене для отображения прогресса
  const jobsByScene: Record<number, SceneJob[]> = {};
  for (const j of jobs) {
    if (!jobsByScene[j.index]) jobsByScene[j.index] = [];
    jobsByScene[j.index].push(j);
  }
  const sceneJobEntries = Object.entries(jobsByScene)
    .map(([k, v]) => ({ sceneIndex: Number(k), jobs: v }))
    .sort((a, b) => a.sceneIndex - b.sceneIndex);

  // Есть ли варианты для выбора (только когда variantsCount > 1 и всё готово)
  const hasVariantsToChoose = variantsCount > 1 && Object.keys(sceneVariants).length > 0;

  // Есть ли видеоклипы с вариантами (из предыдущей генерации)
  const hasStoredVariants = Object.keys(data.videoVariants ?? {}).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Видеоклипы</h2>
        <p className="text-slate-400">AI генерирует клипы для каждой сцены. Выбери лучший вариант.</p>
      </div>

      {/* Восстановленная сессия */}
      {restoredSession && isPolling && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-sm text-blue-300">
          Продолжаю генерацию с прерванного места...
        </div>
      )}

      {/* Стартовый экран */}
      {!isActive && jobs.length === 0 && data.videoClips.length === 0 && (
        <div className="space-y-4">
          {/* Переключатель вариантов */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300 font-medium">Вариантов на сцену</span>
              <div className="flex gap-1">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setVariantsCount(n)}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                      variantsCount === n
                        ? "bg-purple-600 text-white"
                        : "bg-white/10 text-slate-400 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {variantsCount === 1 && (
              <p className="text-xs text-slate-500">Генерируется 1 вариант — быстро и дёшево</p>
            )}
            {variantsCount === 2 && (
              <p className="text-xs text-slate-400">2 варианта — выберешь лучший из двух</p>
            )}
            {variantsCount === 3 && (
              <p className="text-xs text-purple-400">3 варианта — как Егор Кузьмин. Выбор лучшего из трёх.</p>
            )}
          </div>

          {/* Стоимость */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-2">
            {testMode ? (
              <>
                <p>
                  <span className="text-yellow-400 font-medium">Тестовый режим</span> — 1 сцена × {variantsCount} вар. (~${estimateCost(variantsCount).toFixed(2)})
                </p>
                <p className="text-xs">Убедись что всё работает, потом включай полный режим</p>
              </>
            ) : (
              <div className="space-y-1">
                <p>
                  {limitedFrames.length} сцен × {variantsCount} вар. × $0.15 ≈{" "}
                  <span className="text-white font-semibold">${totalCost.toFixed(2)}</span>
                  {variantsCount > 1 && (
                    <span className="ml-2 text-slate-500 text-xs">({variantsCount}× дороже, но выбираешь лучшее)</span>
                  )}
                </p>
                {balanceData && (
                  <p className="text-xs">
                    Баланс: Atlas{" "}
                    <span className={balanceData.atlas.balance !== null && balanceData.atlas.balance < totalCost ? "text-red-400" : "text-green-400"}>
                      ${balanceData.atlas.balance?.toFixed(2) ?? "?"}
                    </span>
                    {" "}/ fal.ai{" "}
                    <span className={balanceData.fal.balance !== null && balanceData.fal.balance < totalCost ? "text-red-400" : "text-green-400"}>
                      ${balanceData.fal.balance?.toFixed(2) ?? "?"}
                    </span>
                  </p>
                )}
              </div>
            )}
            <p>Время: {testMode ? `${variantsCount}–${variantsCount * 2} мин` : `${limitedFrames.length * variantsCount * 2}–${limitedFrames.length * variantsCount * 3} мин`}</p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                role="switch"
                aria-checked={!testMode}
                onClick={() => setTestMode((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors flex items-center px-1 ${
                  testMode ? "bg-yellow-500" : "bg-purple-600"
                }`}
              >
                <span
                  className={`w-4 h-4 bg-white rounded-full transition-transform ${
                    testMode ? "translate-x-0" : "translate-x-5"
                  }`}
                />
              </button>
              <span className="text-sm text-slate-300">
                {testMode ? "Тестовый режим (1 сцена)" : "Полный режим (все сцены)"}
              </span>
            </label>
            {testMode && filteredScript.length > 1 && (
              <p className="text-yellow-400 font-bold text-sm">
                Тестовый режим: генерируется только 1 сцена из {filteredScript.length}, {filteredScript.length - 1} сцен пропускается
              </p>
            )}
          </div>

          <button
            onClick={() => setShowConfirm(true)}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            {testMode
              ? `Генерировать 1 сцену × ${variantsCount} вар.`
              : `Генерировать ${limitedFrames.length} сцен × ${variantsCount} вар.`}
          </button>
        </div>
      )}

      {/* Сабмит */}
      {submitLoading && (
        <div className="text-center py-10 space-y-3">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Отправляю сцены на генерацию...</p>
        </div>
      )}

      {/* Активная модель */}
      {activeModel && jobs.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span>
            Модель:{" "}
            <span className="text-white font-medium">
              {activeModel === "seedance-2.0" ? "Seedance 2.0 (Atlas)" :
               activeModel === "seedance-1.5" ? "Seedance 1.5 (fal.ai)" :
               activeModel}
            </span>
            {activeModel !== "seedance-2.0" && (
              <span className="ml-2 text-yellow-400">fallback активен</span>
            )}
          </span>
        </div>
      )}

      {/* Прогресс генерации */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          {isPolling && totalJobsCount > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-400 px-1">
                <span className="font-medium text-white">
                  {completedJobsCount} / {totalJobsCount} клипов готово
                  {variantsCount > 1 && (
                    <span className="text-slate-500 font-normal text-xs ml-1">({uniqueSceneCount} сцен × {variantsCount} вар.)</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {remainingJobs > 0 && (
                    <span className="text-purple-300">~{etaMin} мин</span>
                  )}
                  <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-purple-600 to-violet-500 transition-all duration-700"
                  style={{ width: totalJobsCount > 0 ? `${(completedJobsCount / totalJobsCount) * 100}%` : "0%" }}
                />
              </div>
            </div>
          )}

          {/* Карточки сцен: группируем варианты */}
          {sceneJobEntries.map(({ sceneIndex, jobs: sceneJobs }) => {
            const firstJob = sceneJobs[0];
            const allSceneDone = sceneJobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED");
            const anySceneActive = sceneJobs.some((j) => j.status === "IN_QUEUE" || j.status === "IN_PROGRESS");

            return (
              <div key={jobKey(sceneIndex, 0)} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Сцена {firstJob.sceneNumber}</span>
                  {anySceneActive && (
                    <span className="text-yellow-400 text-xs flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Генерируется...
                    </span>
                  )}
                  {allSceneDone && !anySceneActive && (
                    <span className="text-green-400 text-xs">Готово</span>
                  )}
                </div>

                {/* Варианты — горизонтальная лента */}
                {sceneJobs.length === 1 ? (
                  // 1 вариант — прежний вид
                  <div>
                    {sceneJobs[0].videoUrl && (
                      <video
                        src={sceneJobs[0].videoUrl}
                        controls
                        playsInline
                        className="w-full aspect-video bg-black rounded-lg"
                      />
                    )}
                    {sceneJobs[0].status === "FAILED" && !sceneJobs[0].videoUrl && sceneJobs[0].error && (
                      <p className="text-red-400 text-xs mt-1">{sceneJobs[0].error}</p>
                    )}
                    {(sceneJobs[0].status === "IN_QUEUE" || sceneJobs[0].status === "IN_PROGRESS") && (
                      <div className="h-24 bg-white/5 rounded-lg flex items-center justify-center">
                        <span className={`text-sm ${STATUS_COLOR[sceneJobs[0].status]}`}>
                          {STATUS_LABEL[sceneJobs[0].status]}
                          {sceneJobs[0].retries > 0 && (
                            <span className="text-xs text-slate-600 ml-1">(попытка {sceneJobs[0].retries + 1}/{MAX_RETRIES + 1})</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  // Несколько вариантов — горизонтальная лента с выбором
                  <div className="space-y-2">
                    <div className="flex gap-1 mb-1">
                      {sceneJobs.map((j) => (
                        <div
                          key={j.variantIndex}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            j.status === "COMPLETED"
                              ? (selectedVariants[sceneIndex] === j.variantIndex ? "bg-purple-500" : "bg-white/30")
                              : j.status === "FAILED"
                              ? "bg-red-400/50"
                              : "bg-white/15"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${sceneJobs.length}, 1fr)` }}>
                      {sceneJobs.map((j) => (
                        <div
                          key={j.variantIndex}
                          onClick={() => j.status === "COMPLETED" && j.videoUrl && selectVariant(sceneIndex, j.variantIndex)}
                          className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                            j.status === "COMPLETED" && j.videoUrl
                              ? selectedVariants[sceneIndex] === j.variantIndex
                                ? "ring-2 ring-purple-500 ring-offset-1 ring-offset-slate-950"
                                : "ring-1 ring-white/10 hover:ring-white/30"
                              : "cursor-default"
                          }`}
                        >
                          {j.videoUrl ? (
                            <>
                              <video
                                src={j.videoUrl}
                                controls
                                playsInline
                                className="w-full aspect-video bg-black"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-black/60 text-xs">
                                <span className="text-slate-300">Вар. {j.variantIndex + 1}</span>
                                {selectedVariants[sceneIndex] === j.variantIndex && (
                                  <span className="text-purple-400 font-medium">Выбран</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="aspect-video bg-white/5 flex items-center justify-center">
                              <span className={`text-xs ${STATUS_COLOR[j.status]}`}>
                                {j.status === "IN_QUEUE" || j.status === "IN_PROGRESS" ? (
                                  <span className="flex items-center gap-1">
                                    <span className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    {STATUS_LABEL[j.status]}
                                  </span>
                                ) : j.error ? (
                                  <span className="text-red-400 px-1 text-center">{j.error}</span>
                                ) : (
                                  STATUS_LABEL[j.status]
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {sceneJobs.some((j) => j.status === "COMPLETED") && (
                      <p className="text-xs text-slate-500">Кликни на вариант чтобы выбрать его для монтажа</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Все упали — кнопка рестарта */}
          {allFailed && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
              <p className="text-red-300 text-sm">Все сцены не удалось сгенерировать. Попробуй снова.</p>
              <button
                onClick={() => setShowConfirm(true)}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Попробовать снова
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ошибка Atlas */}
      {atlasError && (
        <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-xl mt-0.5">!</span>
            <div>
              <p className="text-amber-300 font-medium">Atlas Cloud не отвечает</p>
              <p className="text-slate-400 text-sm mt-1">
                {atlasError.reason === "timeout" && "Сервер не ответил за 60 сек — вероятно временная перегрузка"}
                {atlasError.reason === "http_error" && "Сервер вернул ошибку"}
                {atlasError.reason === "all_retries_failed" && "3 попытки подключения не удались"}
              </p>
              <p className="text-slate-500 text-xs mt-1">
                Обычно Atlas восстанавливается за {atlasError.estimatedWaitMinutes}–3 мин
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => { setAtlasError(null); setShowConfirm(true); }}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              Подождать и повторить (рекомендуется)
            </button>

            {atlasError.fallbackAvailable && (
              <button
                onClick={() => { setAtlasError(null); startGenerationWithFallback(); }}
                className="w-full bg-slate-700 hover:bg-slate-600 border border-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-xl transition-colors"
              >
                Использовать {atlasError.fallbackModel} — чуть хуже, но работает сейчас
              </button>
            )}

            <button
              onClick={() => setAtlasError(null)}
              className="text-slate-500 hover:text-slate-400 text-xs text-center py-1 transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Ошибка сабмита */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300">
          {error}
          <button onClick={() => generateVideo()} className="ml-3 underline">Повторить</button>
        </div>
      )}

      {/* Выбор клипов — после генерации (без вариантов) */}
      {data.videoClips.length > 0 && !hasVariantsToChoose && !hasStoredVariants && (
        <>
          <div className="space-y-4">
            {data.videoClips.map((url, i) => (
              <div
                key={i}
                className={`border-2 rounded-xl overflow-hidden transition-all ${
                  data.selectedClips.includes(i) ? "border-purple-500" : "border-white/10 opacity-60"
                }`}
              >
                <video src={url} controls playsInline className="w-full aspect-video bg-black" />
                <div className="flex items-center justify-between px-4 py-3 bg-white/5">
                  <span className="text-sm text-slate-400">Сцена {i + 1}</span>
                  <button
                    onClick={() => toggleClip(i)}
                    className={`text-sm px-3 py-1 rounded-lg transition-colors ${
                      data.selectedClips.includes(i) ? "bg-purple-600 text-white" : "bg-white/10 text-slate-300"
                    }`}
                  >
                    {data.selectedClips.includes(i) ? "Выбрано" : "Выбрать"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <VoiceoverSection data={data} onUpdate={onUpdate} />
          <MusicSection data={data} onUpdate={onUpdate} />

          {data.musicUrl && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-2">Фоновая музыка</p>
              <audio src={data.musicUrl} controls className="w-full" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Назад
            </button>
            <button
              onClick={onNext}
              disabled={data.selectedClips.length === 0}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Собрать финальное видео →
            </button>
          </div>
        </>
      )}

      {/* Выбор вариантов — когда генерация с несколькими вариантами завершена */}
      {(hasVariantsToChoose || hasStoredVariants) && data.videoClips.length > 0 && (
        <>
          <div className="space-y-1 mb-2">
            <h3 className="text-base font-semibold text-white">Выбери лучший вариант для каждой сцены</h3>
            <p className="text-xs text-slate-400">Кликни на вариант — он пойдёт в монтаж</p>
          </div>

          {Object.entries(hasStoredVariants ? (data.videoVariants ?? {}) : sceneVariants)
            .map(([k, variants]) => ({ sceneIndex: Number(k), variants }))
            .sort((a, b) => a.sceneIndex - b.sceneIndex)
            .map(({ sceneIndex, variants }) => {
              const filtered = variants.filter(Boolean);
              const chosen = selectedVariants[sceneIndex] ?? 0;
              return (
                <div key={sceneIndex} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Сцена {sceneIndex + 1}</span>
                    <div className="flex gap-1">
                      {filtered.map((_, vi) => (
                        <div
                          key={vi}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            chosen === vi ? "bg-purple-500" : "bg-white/20"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${filtered.length}, 1fr)` }}>
                    {filtered.map((url, vi) => (
                      <div
                        key={vi}
                        onClick={() => selectVariant(sceneIndex, vi)}
                        className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                          chosen === vi
                            ? "ring-2 ring-purple-500 ring-offset-1 ring-offset-slate-950"
                            : "ring-1 ring-white/10 hover:ring-white/30"
                        }`}
                      >
                        <video
                          src={url}
                          controls
                          playsInline
                          className="w-full aspect-video bg-black"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-black/60 text-xs">
                          <span className="text-slate-300">Вар. {vi + 1}</span>
                          {chosen === vi && (
                            <span className="text-purple-400 font-medium">Выбран</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

          <VoiceoverSection data={data} onUpdate={onUpdate} />
          <MusicSection data={data} onUpdate={onUpdate} />

          {data.musicUrl && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-2">Фоновая музыка</p>
              <audio src={data.musicUrl} controls className="w-full" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onPrev}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Назад
            </button>
            <button
              onClick={onNext}
              disabled={data.selectedClips.length === 0}
              className="flex-[2] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Собрать финальное видео →
            </button>
          </div>
        </>
      )}

      {/* Модал подтверждения */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white">Подтверди генерацию</h3>
              <p className="text-slate-400 text-sm mt-1">Это действие нельзя отменить — деньги спишутся сразу</p>
            </div>

            <div className="bg-white/5 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Сцен</span>
                <span className="text-white font-medium">{limitedFrames.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Вариантов на сцену</span>
                <span className="text-white font-medium">{variantsCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Стоимость за клип</span>
                <span className="text-white font-medium">~$0.15</span>
              </div>
              <div className="flex justify-between text-sm border-t border-white/10 pt-2 mt-2">
                <span className="text-slate-300 font-medium">Итого</span>
                <span className="text-purple-400 font-bold text-base">~${totalCost.toFixed(2)}</span>
              </div>
              <p className="text-xs text-slate-500">
                Seedance 2.0 (Atlas Cloud) · время ~{limitedFrames.length * variantsCount * 2}–{limitedFrames.length * variantsCount * 3} мин
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 font-medium py-3 rounded-xl transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => { setShowConfirm(false); generateVideo(); }}
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Запустить · ${totalCost.toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
