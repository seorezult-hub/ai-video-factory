import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center space-y-4">
      <div className="flex justify-center">
        <svg
          className="w-16 h-16 text-purple-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-white">Проверь почту</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Мы отправили письмо с подтверждением. Нажми на ссылку в письме чтобы войти.
        </p>
      </div>

      <p className="text-xs text-slate-600">Не пришло? Проверь папку Спам</p>

      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-purple-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Войти
      </Link>
    </div>
  );
}
