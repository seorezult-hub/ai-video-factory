# Stage 1: Build
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Install deps (include devDependencies needed to build Next.js)
COPY package*.json ./
RUN npm ci --include=dev --legacy-peer-deps
# Copy sources
COPY . .
# Build в production-режиме (КРИТИЧЕСКИ ВАЖНО: с NODE_ENV=development Next.js
# ломается на prerender /404 и /500 — "Html should not be imported outside of pages/_document")
ENV NODE_ENV=production
ENV ENCRYPTION_KEY="0efbef2e1d2b0e9cf8bb7856b94b77aee8dfd6fa9754a6d68ccad58ba4d37d93"
ENV NEXT_PUBLIC_SUPABASE_URL="https://xpnhydxwsbacuavcwmzb.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwbmh5ZHh3c2JhY3VhdmN3bXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MzMwMDEsImV4cCI6MjA5MTMwOTAwMX0.bJQaj_RK9sYX42i6o79jink_8klqR6g7NT6WFwDDloo"
ENV NEXT_PUBLIC_APP_URL="https://clipgen.ru"
RUN npm run build

# Stage 2: Runner
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

RUN mkdir -p ./public
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
