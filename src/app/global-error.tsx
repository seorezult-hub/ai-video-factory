"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {

  return (
    <html>
      <body className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-8">
          <h2 className="text-2xl font-bold text-red-400">Что-то пошло не так</h2>
          <p className="text-slate-400 text-sm">Произошла непредвиденная ошибка. Попробуйте ещё раз.</p>
          {error.digest && (
            <p className="text-slate-600 text-xs font-mono">ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="bg-purple-600 hover:bg-purple-500 text-white font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </body>
    </html>
  );
}
