/**
 * rate-limit.ts
 *
 * Production: Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 * Dev/fallback: in-memory Map (single instance only)
 *
 * Window: sliding 60-second window per IP per route.
 */

// ── In-memory fallback ────────────────────────────────────────────────────────

type RateLimitEntry = { count: number; windowStart: number };
const memStore = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;

function memCheckRateLimit(ip: string, route: string, maxRequests: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  // Prune stale entries to prevent memory leak
  if (memStore.size > 10_000) {
    for (const [k, v] of memStore) {
      if (now - v.windowStart > WINDOW_MS) memStore.delete(k);
    }
  }

  const key = `${route}:${ip}`;
  const entry = memStore.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    memStore.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

// ── Upstash Redis ─────────────────────────────────────────────────────────────

async function redisCheckRateLimit(
  ip: string,
  route: string,
  maxRequests: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // No Redis configured — silently fall back to in-memory
    return memCheckRateLimit(ip, route, maxRequests);
  }

  const key = `rl:${route}:${ip}`;

  try {
    // INCR + EXPIRE via pipeline (two commands, one HTTP round-trip)
    const pipeline = [
      ["INCR", key],
      ["EXPIRE", key, "60"],
    ];

    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(3_000), // fast timeout — don't block requests
    });

    if (!res.ok) {
      console.warn("[rate-limit] Redis error:", res.status, "— falling back to in-memory");
      return memCheckRateLimit(ip, route, maxRequests);
    }

    const data = (await res.json()) as Array<{ result: number }>;
    const count = data[0]?.result ?? 1;

    if (count > maxRequests) {
      return { allowed: false, retryAfter: 60 };
    }

    return { allowed: true };
  } catch (e) {
    console.warn("[rate-limit] Redis unreachable:", (e as Error).message, "— falling back to in-memory");
    return memCheckRateLimit(ip, route, maxRequests);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function checkRateLimit(
  ip: string,
  route: string,
  maxRequests: number
): { allowed: boolean; retryAfter?: number } {
  // Sync in-memory check — used when Redis is not configured
  // Async Redis path is used in checkRateLimitAsync
  return memCheckRateLimit(ip, route, maxRequests);
}

/**
 * Async version — uses Redis in production, in-memory in dev.
 * Use this in API routes for correct multi-instance behaviour.
 */
export async function checkRateLimitAsync(
  ip: string,
  route: string,
  maxRequests: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  return redisCheckRateLimit(ip, route, maxRequests);
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  // Trust X-Forwarded-For only if TRUST_PROXY is set (prevents IP spoofing)
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }
  return "unknown";
}
