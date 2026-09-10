const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type MutationGuardOptions = {
  requireJson?: boolean;
  requireMutationHeader?: boolean;
};

function isLoopbackHost(host: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

function canonicalOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host")?.trim();
  const host = requestHost || requestUrl.host;
  const isLoopback = isLoopbackHost(host);

  const configured = String(process.env.SITE_URL || "").trim();
  if (configured) {
    try {
      const configuredUrl = new URL(configured);
      if (isLoopback && isLoopbackHost(configuredUrl.host)) {
        return new URL(`${requestUrl.protocol}//${host}`).origin;
      }
      return configuredUrl.origin;
    } catch {
      return null;
    }
  }
  try {
    if (process.env.NODE_ENV === "production" && !isLoopback) return null;
    return new URL(`${requestUrl.protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

function errorResponse(error: string, status = 403): Response {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS });
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackEquivalent(a: URL, b: URL): boolean {
  return (
    isLoopbackHost(a.host) &&
    isLoopbackHost(b.host) &&
    effectivePort(a) === effectivePort(b)
  );
}

export function validateSameOriginMutation(
  request: Request,
  options: MutationGuardOptions = {},
): Response | null {
  const requireJson = options.requireJson !== false;
  const requireMutationHeader = options.requireMutationHeader !== false;

  const expectedOrigin = canonicalOrigin(request);
  if (!expectedOrigin) return errorResponse("site_origin_not_configured", 503);

  const expectedUrl = new URL(expectedOrigin);
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const isExactMatch = originUrl.origin === expectedOrigin;
      const isLoopbackMatch = isLoopbackEquivalent(originUrl, expectedUrl);
      if (!isExactMatch && !isLoopbackMatch) return errorResponse("invalid_request_origin");
    } catch {
      return errorResponse("invalid_request_origin");
    }
  } else if (!fetchSite) {
    return errorResponse("missing_request_origin");
  }

  if (fetchSite && fetchSite !== "same-origin") {
    let isLoopbackAllowed = false;
    if (origin) {
      try {
        isLoopbackAllowed = isLoopbackEquivalent(new URL(origin), expectedUrl);
      } catch {
        isLoopbackAllowed = false;
      }
    }
    if (!isLoopbackAllowed) {
      return errorResponse("invalid_request_origin");
    }
  }

  if (requireMutationHeader && request.headers.get("x-novel-mutation") !== "1") {
    return errorResponse("missing_mutation_header");
  }
  if (requireJson) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return errorResponse("unsupported_media_type", 415);
    }
  }
  return null;
}
