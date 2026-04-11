import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

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

// GET /api/brand-kits
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "brand-kits", 20);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  try {
    const res = await fetch(
      `${url}/rest/v1/brand_kits?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=updated_at.desc&limit=10`,
      { headers: getHeaders() }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[brand-kits] GET supabase error ${res.status}:`, text);
      return NextResponse.json({ error: "Database error" }, { status: 502 });
    }
    const rows = await res.json();
    return NextResponse.json({ brands: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    console.error("[brand-kits] GET fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

// POST /api/brand-kits
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "brand-kits", 20);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let body: { brand_name: string; data: object };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { brand_name, data } = body;
  if (!brand_name || typeof brand_name !== "string" || !brand_name.trim()) {
    return NextResponse.json({ error: "brand_name is required" }, { status: 400 });
  }

  // Check if brand with same name already exists for this user
  let existingId: string | null = null;
  try {
    const checkRes = await fetch(
      `${url}/rest/v1/brand_kits?user_id=eq.${encodeURIComponent(user.id)}&brand_name=eq.${encodeURIComponent(brand_name.trim())}&select=id`,
      { headers: getHeaders() }
    );
    if (checkRes.ok) {
      const rows = await checkRes.json() as Array<{ id: string }>;
      if (Array.isArray(rows) && rows.length > 0) {
        existingId = rows[0].id;
      }
    }
  } catch (e) {
    console.error("[brand-kits] POST check fetch failed:", e);
  }

  try {
    if (existingId) {
      // Update existing
      const patchRes = await fetch(
        `${url}/rest/v1/brand_kits?id=eq.${encodeURIComponent(existingId)}&user_id=eq.${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: { ...getHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
        }
      );
      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => "");
        console.error(`[brand-kits] POST patch supabase error ${patchRes.status}:`, text);
        return NextResponse.json({ error: "Failed to update brand kit" }, { status: 502 });
      }
      return NextResponse.json({ id: existingId });
    } else {
      // Create new
      const postRes = await fetch(`${url}/rest/v1/brand_kits`, {
        method: "POST",
        headers: { ...getHeaders(), Prefer: "return=representation" },
        body: JSON.stringify({ user_id: user.id, brand_name: brand_name.trim(), data }),
      });
      if (!postRes.ok) {
        const text = await postRes.text().catch(() => "");
        console.error(`[brand-kits] POST create supabase error ${postRes.status}:`, text);
        return NextResponse.json({ error: "Failed to create brand kit" }, { status: 502 });
      }
      const rows = await postRes.json() as Array<{ id: string }>;
      const created = Array.isArray(rows) ? rows[0] : (rows as { id: string });
      if (!created?.id) return NextResponse.json({ error: "Failed to create brand kit" }, { status: 500 });
      return NextResponse.json({ id: created.id });
    }
  } catch (e) {
    console.error("[brand-kits] POST fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

// DELETE /api/brand-kits?id=uuid
export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimitAsync(ip, "brand-kits", 20);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  try {
    const res = await fetch(
      `${url}/rest/v1/brand_kits?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE", headers: { ...getHeaders(), Prefer: "return=minimal" } }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[brand-kits] DELETE supabase error ${res.status}:`, text);
      return NextResponse.json({ error: "Failed to delete brand kit" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[brand-kits] DELETE fetch failed:", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
