import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function getHeaders() {
  const key = supabaseKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    apikey: key,
  };
}

// GET /api/projects?id=uuid
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let rows: unknown;
  try {
    const res = await fetch(
      `${url}/rest/v1/projects?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`,
      { headers: getHeaders() }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[projects] GET supabase error ${res.status}:`, text);
      return NextResponse.json({ error: "Database error" }, { status: 502 });
    }
    rows = await res.json();
  } catch (e) {
    console.error("[projects] GET fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

// POST /api/projects
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let body: { data: unknown; currentStep?: number; brandName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data, currentStep, brandName } = body;

  let rows: unknown;
  try {
    const res = await fetch(`${url}/rest/v1/projects`, {
      method: "POST",
      headers: {
        ...getHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: user.id,
        data,
        current_step: currentStep ?? 1,
        brand_name: brandName ?? "",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[projects] POST supabase error ${res.status}:`, text);
      return NextResponse.json({ error: "Failed to create project", detail: text }, { status: 502 });
    }
    rows = await res.json();
  } catch (e) {
    console.error("[projects] POST fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  const project = Array.isArray(rows) ? (rows as Record<string, unknown>[])[0] : rows as Record<string, unknown>;
  if (!project?.id) return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  return NextResponse.json({ id: project.id });
}

// PUT /api/projects?id=uuid
export async function PUT(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Проверяем что проект принадлежит текущему пользователю
  let checkRows: unknown;
  try {
    const checkRes = await fetch(
      `${url}/rest/v1/projects?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
      { headers: getHeaders() }
    );
    if (!checkRes.ok) {
      const text = await checkRes.text().catch(() => "");
      console.error(`[projects] PUT check supabase error ${checkRes.status}:`, text);
      return NextResponse.json({ error: "Database error" }, { status: 502 });
    }
    checkRows = await checkRes.json();
  } catch (e) {
    console.error("[projects] PUT check fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  if (!Array.isArray(checkRows) || !checkRows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { data: unknown; currentStep?: number; brandName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data, currentStep, brandName } = body;

  try {
    const patchRes = await fetch(`${url}/rest/v1/projects?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: {
        ...getHeaders(),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        data,
        current_step: currentStep ?? 1,
        brand_name: brandName ?? "",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      console.error(`[projects] PUT patch supabase error ${patchRes.status}:`, text);
      return NextResponse.json({ error: "Failed to update project", detail: text }, { status: 502 });
    }
  } catch (e) {
    console.error("[projects] PUT patch fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
