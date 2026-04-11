# Session Handoff — clipgen.ru деплой

Дата: 2026-04-12
Проект: /Users/vagiz/Documents/Projects/video-service

## Что было сделано

### Корень проблемы (РЕШЕНО)
Docker build падал с `<Html> should not be imported outside of pages/_document`.
**Причина**: `ENV NODE_ENV=development` перед `RUN npm run build` в Dockerfile.
В development-режиме Next.js 15 не изолирует Pages Router chunks при prerender /404 и /500.
**Фикс**: добавить `ENV NODE_ENV=production` перед `RUN npm run build`.

### Все изменения (commit 2902eab)
- Dockerfile: `node:22-slim`, `npm ci --include=dev`, `ENV NODE_ENV=production` перед build
- .dockerignore: добавлен `.next`, `wrangler.toml`, `.vercel`
- sentry.client/server/edge.config.ts — удалены
- src/lib/user-keys.ts — удалён top-level throw при импорте
- src/app/api/generate/assemble/route.ts — удалён top-level probeFFmpegTransitions()
- src/app/dashboard/page.tsx — добавлен `export const dynamic = "force-dynamic"`
- src/app/not-found.tsx — создан (App Router 404)
- src/app/error.tsx — создан (App Router 500)
- @cloudflare/next-on-pages, vercel — удалены из devDeps
- undici — добавлен напрямую
- package.json — удалены Cloudflare скрипты pages:build

### Локальный Docker build
`docker build -t test-fix /Users/vagiz/Documents/Projects/video-service` — УСПЕХ (32/32 pages)

## Текущий статус

Деплой на сервер (155.212.141.8) запущен через GitHub Actions (commit 2902eab).
GitHub Actions: https://github.com/seorezult-hub/ai-video-factory/actions

## Следующие шаги

1. Дождаться завершения GitHub Actions деплоя
2. Проверить https://clipgen.ru/api/health — должен вернуть 200
3. Проверить https://clipgen.ru — должны быть стили и блоки загрузки изображений на шаге 1
4. Протестировать загрузку изображений в слоты @Image1-3 (исправлен tier gate)
5. Оставшиеся баги из аудита (bug-hunter нашёл 28 багов — см. ниже)

## Критические баги к исправлению (после деплоя)

- BUG-004: Stale state теряет hero при автогенерации (StepBrief.tsx:389-403)
- BUG-005: SSRF неполный PRIVATE_IP_RE в 3 routes
- BUG-006: redirect:"manual" + status check сломан в 5 routes
- BUG-007: Hardcoded ENCRYPTION_KEY в Dockerfile layers
- BUG-009: analyze/youtube, video-reference, asset-quality не используют resolveApiKey
- BUG-011: parse/route.ts не поддерживает videoDuration "15-single" → 500

## GitHub репо
https://github.com/seorezult-hub/ai-video-factory

## Сервер
VPS: 155.212.141.8, /opt/video-service
Деплой: GitHub Actions → SSH → docker compose build + up
