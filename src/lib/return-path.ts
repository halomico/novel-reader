export function normalizeUserReturnPath(value: unknown, fallback = "/account?view=growth"): string {
  const path = String(value || "").trim().slice(0, 500);
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\u0000-\u001f\u007f\\]/u.test(path) ||
    path === "/login" ||
    path.startsWith("/login?") ||
    path === "/register" ||
    path.startsWith("/register?") ||
    path === "/admin" ||
    path.startsWith("/admin/")
  ) {
    return fallback;
  }
  return path;
}
