"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // Если сессия уже восстановлена (токен в хэше уже обработан)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (password.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/dashboard"), 2000);
  }

  if (!ready) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-5">
        <h2 className="text-xl font-semibold text-white">Сброс пароля</h2>
        <p className="text-sm text-slate-400">
          Ожидание подтверждения ссылки из письма...
        </p>
        <p className="text-xs text-slate-500">
          Перейдите по ссылке из письма, чтобы попасть на эту страницу.
        </p>
        <Link href="/login" className="block text-center text-sm text-purple-400 hover:text-purple-300 transition-colors">
          Вернуться к входу
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-5">
        <h2 className="text-xl font-semibold text-white">Готово!</h2>
        <p className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">
          Пароль успешно обновлён. Перенаправляем на дашборд...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-5">
      <h2 className="text-xl font-semibold text-white">Новый пароль</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm text-slate-400">Новый пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-600 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-slate-400">Подтверждение пароля</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-600 transition-colors"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loading ? "Сохраняем..." : "Сохранить пароль"}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">
          Вернуться к входу
        </Link>
      </p>
    </div>
  );
}
