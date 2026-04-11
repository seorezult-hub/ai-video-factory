/**
 * sentry-capture.ts
 *
 * Тонкая обёртка для захвата ошибок в API routes.
 * Работает gracefully если Sentry не настроен — просто логирует в console.
 */

export function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const extra = context ?? {};

  // Только если DSN настроен
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      // Dynamic import — не блокируем startup если Sentry не установлен
      import("@sentry/nextjs").then(({ captureException, withScope }) => {
        withScope((scope) => {
          scope.setExtras(extra);
          captureException(error instanceof Error ? error : new Error(message));
        });
      }).catch(() => {});
    } catch {}
  }

  // Всегда логируем в console для server logs
  console.error("[error]", message, extra);
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "error") {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      import("@sentry/nextjs").then(({ captureMessage: sm }) => {
        sm(message, level);
      }).catch(() => {});
    } catch {}
  }
  if (level === "error") console.error("[sentry]", message);
  else if (level === "warning") console.warn("[sentry]", message);
}
