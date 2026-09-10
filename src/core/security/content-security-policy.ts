function httpOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Build at request time: Docker media/analytics configuration is runtime-only. */
export function contentSecurityPolicy(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const analytics = new Set<string>();
  for (const value of [env.SCRIPT_URL, env.UMAMI_RECORDER_URL]) {
    const origin = httpOrigin(value);
    if (origin) analytics.add(origin);
  }
  const media = new Set<string>();
  if (env.MEDIA_STORAGE_MODE === "remote") {
    if (env.MEDIA_NODES_JSON?.trim()) {
      try {
        const nodes: unknown = JSON.parse(env.MEDIA_NODES_JSON);
        if (Array.isArray(nodes)) {
          for (const node of nodes) {
            const origin = httpOrigin(node?.publicUrl);
            if (origin) media.add(origin);
          }
        }
      } catch {
        // Invalid storage configuration fails closed in the media service.
      }
    } else {
      const origin = httpOrigin(env.MEDIA_PUBLIC_URL);
      if (origin) media.add(origin);
    }
  }
  const development = env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com ${[...analytics].join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${[...media].join(" ")}`.trim(),
    `media-src 'self' blob: ${[...media].join(" ")}`.trim(),
    `connect-src 'self' https://challenges.cloudflare.com ${[...new Set([...analytics, ...media])].join(" ")}${development ? " ws: wss:" : ""}`.trim(),
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; ");
}
