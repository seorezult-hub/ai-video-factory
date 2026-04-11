import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Page routes требующие авторизации
const PROTECTED_ROUTES = ["/create", "/dashboard"];
// Роуты только для гостей (редирект если уже залогинен)
const GUEST_ONLY_ROUTES = ["/login", "/register", "/verify-email"];

// API routes требующие авторизации (проверка сессии, 401 если нет)
const PROTECTED_API_PREFIXES = [
  "/api/generate/",
  "/api/analyze/",
  "/api/enhance/",
  "/api/user/",
  "/api/projects",
  "/api/balances",
  "/api/storage/",
];
// Публичные API — не трогаем
const PUBLIC_API_EXACT = new Set([
  "/api/health",
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();

  // ── API routes ──────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    // Публичные API — пропускаем без проверок
    if (PUBLIC_API_EXACT.has(pathname)) return res;

    // Server-to-server: shared secret — пропускаем (только если секрет длиннее 16 символов)
    const apiSecret = req.headers.get("x-api-secret");
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (internalSecret && internalSecret.length >= 16 && apiSecret === internalSecret) return res;

    // Проверяем авторизацию для защищённых API routes
    const needsAuth = PROTECTED_API_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
    if (needsAuth) {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => req.cookies.getAll(),
            setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
              cookiesToSet.forEach(({ name, value, options }) =>
                res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
              );
            },
          },
        }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    return res;
  }

  // ── Page routes ─────────────────────────────────────────────────
  const isProtected = PROTECTED_ROUTES.some((r) => pathname.startsWith(r));
  const isGuestOnly = GUEST_ONLY_ROUTES.some((r) => pathname.startsWith(r));

  if (!isProtected && !isGuestOnly) return res;

  // Проверяем сессию через Supabase
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Не залогинен → редирект на /login
  if (isProtected && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Уже залогинен → редирект с /login и /register на /dashboard
  if (isGuestOnly && user) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/api/:path*", "/create/:path*", "/dashboard/:path*", "/login", "/register", "/verify-email"],
};
