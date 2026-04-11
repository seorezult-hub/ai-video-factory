export function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const extra = context ?? {};
  console.error("[error]", message, extra);
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "error") {
  if (level === "error") console.error("[sentry]", message);
  else if (level === "warning") console.warn("[sentry]", message);
}
