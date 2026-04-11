import { NextResponse } from "next/server";
import { registry } from "@/lib/model-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const modelStatus = registry.getStatus();

  const available = Object.entries(modelStatus)
    .filter(([, s]) => s.status === "OK")
    .map(([name]) => name);

  const cooldown = Object.entries(modelStatus)
    .filter(([, s]) => s.status === "COOLDOWN")
    .map(([name, s]) => ({ name, until: s.cooldownUntil }));

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "ai-video-factory",
    version: process.env.npm_package_version ?? "1.0.0",
    models: {
      available,
      cooldown,
    },
  });
}
