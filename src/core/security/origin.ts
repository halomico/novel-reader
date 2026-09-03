const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type MutationGuardOptions = {
  requireJson?: boolean;
  requireMutationHeader?: boolean;
};

function canonicalOrigin(request: Request): string | null {
  const configured = String(process.env.SITE_URL || "").trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

function errorResponse(error: string, status = 403): Response {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Fast browser mutation guard. It performs only header parsing and string
 * comparisons, before authentication or database access.
 */
export function validateSameOriginMutation(
  request: Request,
  options: MutationGuardOptions = {},
): Response | null {
  const requireJson = options.requireJson !== false;
  const requireMutationHeader = options.requireMutationHeader !== false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return errorResponse("invalid_request_origin");

  const expectedOrigin = canonicalOrigin(request);
  if (!expectedOrigin) return errorResponse("site_origin_not_configured", 503);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== expectedOrigin) return errorResponse("invalid_request_origin");
    } catch {
      return errorResponse("invalid_request_origin");
    }
  } else if (!fetchSite) {
    return errorResponse("missing_request_origin");
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

export function mutationHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("X-Novel-Mutation", "1");
  return headers;
}
