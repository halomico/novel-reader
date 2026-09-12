import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./.env*", "./**/.env*", "./data/**/*", "./library/**/*",
      "./backups/**/*", "./deploy/**/*", "./docs/**/*",
      "./public/avatars/**/*", "./**/*.db", "./**/*.db-*",
      "./**/*.sqlite*", "./**/*.pem", "./**/*.key",
    ],
  },
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          ...(process.env.ENABLE_HSTS === "1"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      {
        // Bundled avatar art is versioned with the release but not content-hashed:
        // browsers keep it a day, the CDN a week, both revalidating in the background.
        source: "/:dir(default-avatars|avatar-widgets)/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
          { key: "CDN-Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" },
          { key: "Cloudflare-CDN-Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" },
        ],
      },
      {
        // Uploaded avatar names contain the user, timestamp and random suffix. A
        // replacement therefore gets a new URL and the old object is immutable.
        source: "/avatars/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cloudflare-CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/favicon.ico",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
  experimental: {
    // Browser-local RSC reuse only; personal pages are never put in a shared cache.
    // Visited dynamic pages are reused for a minute and intent-prefetched pages for
    // three, which keeps back-and-forth browsing instant. Mutations still call
    // revalidatePath/router.refresh, which purges these entries immediately.
    staleTimes: { dynamic: 60, static: 180 },
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
