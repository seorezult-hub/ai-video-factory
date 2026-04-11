import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { encryptKey } from "@/lib/user-keys";

export const runtime = "nodejs";

async function getUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
}

const ALLOWED_SERVICES = [
  "fal", "atlas", "piapi", "elevenlabs",
  "groq", "gemini", "mubert", "topaz", "openai",
];

export async function GET() {
  const { user, supabase } = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("user_api_keys")
    .select("service, updated_at")
    .eq("user_id", user.id);

  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { service?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { service, key } = body;

  if (typeof service !== "string" || !ALLOWED_SERVICES.includes(service)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }
  if (typeof key !== "string" || key.length < 8 || key.length > 500) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const encrypted = encryptKey(key);

  const { error } = await supabase
    .from("user_api_keys")
    .upsert(
      { user_id: user.id, service, encrypted_key: encrypted },
      { onConflict: "user_id,service" }
    );

  if (error) {
    console.error("[api-keys] upsert error:", error.message);
    return NextResponse.json({ error: "Ошибка сохранения ключа" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { user, supabase } = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { service?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { service } = body;

  if (typeof service !== "string" || !ALLOWED_SERVICES.includes(service)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }

  try {
    const { error } = await supabase
      .from("user_api_keys")
      .delete()
      .eq("user_id", user.id)
      .eq("service", service);
    if (error) {
      console.error("[api-keys] delete error:", error.message);
      return NextResponse.json({ error: "Ошибка удаления ключа" }, { status: 500 });
    }
  } catch (e) {
    console.error("[api-keys] delete exception:", e);
    return NextResponse.json({ error: "Ошибка удаления ключа" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
