"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

const SERVICES = [
  { id: "atlas",      label: "Atlas Cloud (Seedance 2.0)", placeholder: "atl-...",  icon: "🎬", url: "https://atlascloud.ai/dashboard/api-keys" },
  { id: "fal",        label: "fal.ai (Flux, Recraft)",      placeholder: "fal-...",  icon: "⚡", url: "https://fal.ai/dashboard/keys" },
  { id: "piapi",      label: "piapi.ai (Midjourney v7)",    placeholder: "piai-...", icon: "🎨", url: "https://piapi.ai/manage-api-key" },
  { id: "elevenlabs", label: "ElevenLabs (Войсовер)",       placeholder: "sk_...",   icon: "🎙️", url: "https://elevenlabs.io/app/settings/api-keys" },
  { id: "groq",       label: "Groq (Сценарий AI)",          placeholder: "gsk_...",  icon: "🧠", url: "https://console.groq.com/keys" },
  { id: "gemini",     label: "Google Gemini (Анализ)",      placeholder: "AIza...",  icon: "✨", url: "https://aistudio.google.com/apikey" },
  { id: "mubert",     label: "Mubert (Музыка)",             placeholder: "...",      icon: "🎵", url: "https://mubert.com/develop" },
  { id: "topaz",      label: "Topaz Labs (4K апскейл)",     placeholder: "...",      icon: "🔮", url: "https://www.topazlabs.com/account" },
] as const;

type ServiceId = (typeof SERVICES)[number]["id"];

export default function SettingsPage() {
  const [savedKeys, setSavedKeys] = useState<Set<ServiceId>>(new Set());
  const [inputs, setInputs] = useState<Partial<Record<ServiceId, string>>>({});
  const [saving, setSaving] = useState<Partial<Record<ServiceId, boolean>>>({});
  const [saved, setSaved] = useState<Partial<Record<ServiceId, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<ServiceId, string>>>({});

  useEffect(() => {
    fetch("/api/user/api-keys")
      .then((r) => r.json())
      .then((data) => {
        if (data.keys) {
          setSavedKeys(new Set(data.keys.map((k: { service: string }) => k.service as ServiceId)));
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave(serviceId: ServiceId) {
    const key = inputs[serviceId]?.trim();
    if (!key) return;

    setSaving((p) => ({ ...p, [serviceId]: true }));
    setErrors((p) => ({ ...p, [serviceId]: undefined }));

    try {
      const res = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceId, key }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrors((p) => ({ ...p, [serviceId]: data.error ?? "Ошибка сохранения" }));
      } else {
        setSavedKeys((prev) => new Set([...prev, serviceId]));
        setInputs((p) => ({ ...p, [serviceId]: "" }));
        setSaved((p) => ({ ...p, [serviceId]: true }));
        setTimeout(() => setSaved((p) => ({ ...p, [serviceId]: false })), 2000);
      }
    } catch {
      setErrors((p) => ({ ...p, [serviceId]: "Сетевая ошибка" }));
    } finally {
      setSaving((p) => ({ ...p, [serviceId]: false }));
    }
  }

  async function handleDelete(serviceId: ServiceId) {
    try {
      await fetch("/api/user/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceId }),
      });
      setSavedKeys((prev) => {
        const next = new Set(prev);
        next.delete(serviceId);
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Шапка */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="text-slate-400 hover:text-white text-sm transition-colors mb-4 inline-block"
          >
            ← Личный кабинет
          </Link>
          <h1 className="text-2xl font-bold">Настройки API ключей</h1>
          <p className="text-slate-400 text-sm mt-2">
            Ключи хранятся зашифрованно. Вводишь один раз — сервис использует
            их при каждой генерации.
          </p>
        </div>

        {/* Список сервисов */}
        <div className="flex flex-col gap-3">
          {SERVICES.map((service) => {
            const isSaved = savedKeys.has(service.id);
            const isSaving = saving[service.id];
            const justSaved = saved[service.id];
            const error = errors[service.id];

            return (
              <div
                key={service.id}
                className="bg-white/5 border border-white/10 rounded-xl p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl shrink-0">{service.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">{service.label}</span>
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-400 hover:text-purple-300 text-xs transition-colors shrink-0"
                      >
                        Получить ключ →
                      </a>
                      {isSaved && (
                        <span className="text-green-400 text-xs flex items-center gap-1">
                          <svg
                            className="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Сохранён
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        placeholder={isSaved ? "••••••••••••" : service.placeholder}
                        value={inputs[service.id] ?? ""}
                        onChange={(e) =>
                          setInputs((p) => ({ ...p, [service.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave(service.id);
                        }}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                      />
                      <button
                        onClick={() => handleSave(service.id)}
                        disabled={!inputs[service.id]?.trim() || isSaving}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0"
                      >
                        {isSaving ? "..." : justSaved ? "Сохранено" : "Сохранить"}
                      </button>
                      {isSaved && (
                        <button
                          onClick={() => handleDelete(service.id)}
                          className="text-slate-500 hover:text-red-400 text-xs px-2 py-1.5 rounded-lg transition-colors shrink-0"
                          title="Удалить ключ"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {error && (
                      <p className="text-red-400 text-xs mt-1">{error}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
