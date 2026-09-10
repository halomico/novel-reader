export type JsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "too_large" | "invalid" };

const DEFAULT_JSON_LIMIT = 128 * 1024;

export function exceedsContentLength(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyResult<Uint8Array>> {
  if (exceedsContentLength(request, maxBytes)) {
    void request.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: false, reason: "invalid" };
  const reader = request.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: bytes };
  } catch {
    void reader.cancel().catch(() => undefined);
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

/** Bounds the incoming stream, then accepts JSON objects only. */
export async function readJsonBody<T>(
  request: Request,
  maxBytes = DEFAULT_JSON_LIMIT,
): Promise<JsonBodyResult<T>> {
  const body = await readBoundedBody(request, maxBytes);
  if (!body.ok) return body;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.value));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Enforces the aggregate multipart limit even without Content-Length. */
export async function readFormBody(request: Request, maxBytes: number): Promise<JsonBodyResult<FormData>> {
  const body = await readBoundedBody(request, maxBytes);
  if (!body.ok) return body;
  try {
    const response = new Response(body.value as BodyInit, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    });
    return { ok: true, value: await response.formData() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
