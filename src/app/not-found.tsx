import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md p-8">
        <h2 className="text-2xl font-bold text-slate-300">404 — Страница не найдена</h2>
        <p className="text-slate-400 text-sm">Эта страница не существует.</p>
        <Link href="/" className="inline-block bg-purple-600 hover:bg-purple-500 text-white font-medium px-6 py-3 rounded-xl transition-colors">
          На главную
        </Link>
      </div>
    </div>
  );
}
