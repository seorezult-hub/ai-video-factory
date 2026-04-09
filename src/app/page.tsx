import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            AI Video Factory
          </h1>
          <p className="text-xl text-purple-200">
            Professional AI videos for brands — in 30 minutes
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
          {[
            { step: "01", label: "Fill brief" },
            { step: "02", label: "Review script" },
            { step: "03", label: "Pick frames" },
            { step: "04", label: "Select clips" },
            { step: "05", label: "Add music" },
            { step: "06", label: "Download" },
          ].map(({ step, label }) => (
            <div
              key={step}
              className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1"
            >
              <div className="text-purple-400 font-mono text-xs">{step}</div>
              <div>{label}</div>
            </div>
          ))}
        </div>

        <Link
          href="/create"
          className="inline-block bg-purple-600 hover:bg-purple-500 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors"
        >
          Create Your Video
        </Link>

        <p className="text-slate-500 text-sm">
          Free tier: 3 videos/month · No watermark on Pro
        </p>
      </div>
    </main>
  );
}
