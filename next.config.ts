import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages requires edge runtime
  // Individual routes set: export const runtime = 'edge'
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "*.cloudflare.com",
      },
    ],
  },
};

export default nextConfig;
