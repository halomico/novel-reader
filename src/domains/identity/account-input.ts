export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 32) return "用户名长度需要在 3-32 个字符之间";
  return /^[a-z0-9_-]+$/u.test(username) ? null : "用户名只能包含英文、数字、下划线和短横线";
}

export function validatePassword(value: string): string | null {
  return value.length < 6 || value.length > 256 ? "密码长度需要在 6-256 个字符之间" : null;
}

export function validateDisplayName(value: string): string | null {
  const length = Array.from(value.trim()).length;
  return length < 1 || length > 40 ? "显示名称长度需要在 1-40 个字符之间" : null;
}

export function normalizeEmail(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value);
  return email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ? "请输入有效的邮箱地址"
    : null;
}
