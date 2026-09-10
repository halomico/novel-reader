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
    ];
  },
  experimental: {
    // Browser-local RSC reuse; personal pages are never put in a shared cache.
    staleTimes: { dynamic: 30, static: 60 },
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
