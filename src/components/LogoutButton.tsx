"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        router.push("/login");
      }}
      className="text-slate-400 hover:text-white text-sm transition-colors"
    >
      Выйти
    </button>
  );
}
