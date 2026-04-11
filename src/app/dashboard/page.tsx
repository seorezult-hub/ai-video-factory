import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, brand_name, current_step, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);

  const displayName =
    profile?.full_name ?? user.email?.split("@")[0] ?? "Пользователь";

  const planColors: Record<string, string> = {
    free: "bg-slate-700 text-slate-300",
    starter: "bg-blue-900 text-blue-300",
    pro: "bg-purple-900 text-purple-300",
    agency: "bg-amber-900 text-amber-300",
  };
  const plan = profile?.plan ?? "free";
  const planBadge = planColors[plan] ?? planColors.free;

  const videosLimit = profile?.videos_limit ?? 3;
  const videosUsed = profile?.videos_used ?? 0;

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Шапка */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-slate-400 text-sm mb-1">Личный кабинет</p>
            <h1 className="text-2xl font-bold">
              Добро пожаловать, {displayName}
            </h1>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard/settings"
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Настройки
            </Link>
            <LogoutButton />
            <Link
              href="/create"
              className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              Создать ролик →
            </Link>
          </div>
        </div>

        {/* Статистика */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <p className="text-slate-400 text-xs mb-2">Роликов создано</p>
            <p className="text-3xl font-bold">{projects?.length ?? 0}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <p className="text-slate-400 text-xs mb-2">Тариф</p>
            <span
              className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${planBadge}`}
            >
              {plan}
            </span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <p className="text-slate-400 text-xs mb-2">Осталось в месяц</p>
            <p className="text-3xl font-bold">
              {Math.max(0, videosLimit - videosUsed)}
              <span className="text-slate-500 text-base font-normal">
                /{videosLimit}
              </span>
            </p>
          </div>
        </div>

        {/* Список проектов */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Мои проекты</h2>

          {!projects || projects.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-16 flex flex-col items-center gap-4">
              <span className="text-5xl">🎬</span>
              <p className="text-slate-400">У вас пока нет проектов</p>
              <Link
                href="/create"
                className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                Создать первый ролик
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">
                      {project.brand_name || "Без названия"}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {formatDate(project.updated_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col gap-1 w-32">
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Шаг {project.current_step ?? 1} из 5</span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-600 rounded-full transition-all"
                          style={{
                            width: `${((project.current_step ?? 1) / 5) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    <Link
                      href={`/create?id=${project.id}`}
                      className="bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Продолжить →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
