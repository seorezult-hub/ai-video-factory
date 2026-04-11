"use client";

import { useState } from "react";
import { ProjectData } from "@/app/create/page";

const PRESET_VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "мужской · нейтральный · реклама" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", desc: "женский · мягкий · beauty" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "мужской · авторитетный · люкс" },
  { id: "jsCqWAovK2LkecY7zXl4", name: "Freya", desc: "женский · молодой · fashion" },
  { id: "oWAxZDx7w5VEj9dCyTzz", name: "Grace", desc: "женский · тёплый · lifestyle" },
  { id: "custom", name: "Свой голос ID", desc: "вставь ID из ElevenLabs" },
];

type Props = {
  data: ProjectData;
  onUpdate: (u: Partial<ProjectData>) => void;
};

export function VoiceoverSection({ data, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customVoiceId, setCustomVoiceId] = useState("");

  const selectedVoiceId = data.voiceoverId;
  const isCustom = !PRESET_VOICES.slice(0, -1).find((v) => v.id === selectedVoiceId);

  const effectiveVoiceId = isCustom ? (customVoiceId || selectedVoiceId) : selectedVoiceId;

  const generateScript = async () => {
    setLoadingScript(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "script",
          brandName: data.brandName,
          mood: data.mood,
          productDescription: data.productDescription,
          targetAudience: data.targetAudience,
          videoDuration: data.videoDuration,
          scenes: data.script?.slice(0, 5),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка генерации");
      onUpdate({ voiceoverScript: json.script ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoadingScript(false);
    }
  };

  const generateAudio = async () => {
    if (!data.voiceoverScript.trim()) return;
    setLoadingAudio(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "audio",
          script: data.voiceoverScript,
          voiceId: effectiveVoiceId,
          brandName: data.brandName,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка ElevenLabs");
      onUpdate({ voiceoverUrl: json.audioUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoadingAudio(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("audio/")) {
      setError("Нужен аудио файл (mp3, wav, m4a)");
      return;
    }
    if (file.size > 50 * 1024 * 1024) { setError("Максимум 50 МБ"); return; }
    setLoadingAudio(true);
    setError(null);
    try {
      const key = `voiceover/upload-${Date.now()}.mp3`;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("key", key);
      const res = await fetch("/api/storage/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Ошибка загрузки");
      const { url } = await res.json();
      onUpdate({ voiceoverUrl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadingAudio(false);
    }
  };

  return (
    <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-300 font-medium text-sm">Голосовая озвучка</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">необязательно</span>
          {data.voiceoverUrl && <span className="text-xs text-green-400">✓ Готова</span>}
        </div>
        <span className="text-slate-500 text-sm">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-white/5 pt-4">
          <p className="text-xs text-slate-500">
            ElevenLabs генерирует рекламный голос на русском. Текст пишет AI на основе брифа.
            Голос микшируется в финальное видео (музыка автоматически тише).
          </p>

          {/* Шаг 1: скрипт */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 font-medium">1. Текст озвучки</p>
              <button
                onClick={generateScript}
                disabled={loadingScript}
                className="text-xs bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {loadingScript ? (
                  <><span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />Пишу...</>
                ) : "✦ Написать с AI"}
              </button>
            </div>
            <textarea
              value={data.voiceoverScript}
              onChange={(e) => onUpdate({ voiceoverScript: e.target.value })}
              placeholder="Текст будет написан AI или введи свой..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 placeholder-slate-600 text-sm resize-none focus:outline-none focus:border-purple-500 leading-relaxed"
            />
            {data.voiceoverScript && (
              <p className="text-xs text-slate-600">
                ~{Math.round(data.voiceoverScript.split(" ").length / 2.5)} сек · {data.voiceoverScript.split(" ").length} слов
              </p>
            )}
          </div>

          {/* Шаг 2: голос */}
          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">2. Голос</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_VOICES.map((v) => {
                const selected = v.id === "custom" ? isCustom : v.id === selectedVoiceId;
                return (
                  <button
                    key={v.id}
                    onClick={() => onUpdate({ voiceoverId: v.id === "custom" ? customVoiceId || "" : v.id })}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      selected ? "border-purple-500 bg-purple-500/10" : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className={`text-sm font-medium ${selected ? "text-white" : "text-slate-300"}`}>{v.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{v.desc}</div>
                  </button>
                );
              })}
            </div>
            {isCustom && (
              <input
                type="text"
                value={customVoiceId}
                onChange={(e) => { setCustomVoiceId(e.target.value); onUpdate({ voiceoverId: e.target.value }); }}
                placeholder="Voice ID из ElevenLabs (напр. pNInz6obpgDQGcFmaJgB)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 text-xs"
              />
            )}
          </div>

          {/* Шаг 3: генерация / загрузка */}
          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">3. Сгенерировать или загрузить</p>
            <div className="flex gap-2">
              <button
                onClick={generateAudio}
                disabled={loadingAudio || !data.voiceoverScript.trim()}
                className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loadingAudio ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Генерирую...</>
                ) : "Озвучить (ElevenLabs)"}
              </button>
              <label className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-xl cursor-pointer text-center transition-colors">
                Загрузить mp3
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
              </label>
            </div>
            <p className="text-xs text-slate-600">
              ~$0.05–0.15 за 30 сек · eleven_multilingual_v2 · поддерживает русский
            </p>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Превью */}
          {data.voiceoverUrl && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-medium">Превью озвучки</p>
              <audio src={data.voiceoverUrl} controls className="w-full" />
              <p className="text-xs text-green-400">
                ✓ Будет вмонтирована в финальное видео. Музыка автоматически приглушается.
              </p>
              <button
                onClick={() => onUpdate({ voiceoverUrl: null })}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Удалить озвучку
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
