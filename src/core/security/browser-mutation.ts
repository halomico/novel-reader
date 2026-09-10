/**
 * Builds the request contract required by same-origin JSON mutation routes.
 * Keeping this in one client-safe helper prevents individual controls from
 * silently drifting away from the CSRF guard when they do not need a payload.
 */
export function jsonMutationRequest(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Novel-Mutation", "1");

  return {
    credentials: "same-origin",
    ...init,
    headers,
    body: init.body ?? "{}",
  };
}
