import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.elevenlabs.io https://generativelanguage.googleapis.com https://queue.fal.run https://fal.run https://*.fal.media https://*.atlascloud.ai https://api.atlascloud.ai https://api.groq.com https://openrouter.ai https://api.firecrawl.dev https://api.piapi.ai; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self'; frame-src 'none'; object-src 'none';" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.cloudflare.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.fal.run" },
      { protocol: "https", hostname: "*.fal.media" },
      { protocol: "https", hostname: "v3.fal.media" },
      { protocol: "https", hostname: "v3b.fal.media" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "*.atlascloud.ai" },
      { protocol: "https", hostname: "cdn.replicate.delivery" },
      { protocol: "https", hostname: "piapi.ai" },
      { protocol: "https", hostname: "*.piapi.ai" },
    ],
  },
};

export default nextConfig;
