import assert from "node:assert/strict";
import test from "node:test";
import { isEmailVerificationConfigured } from "./email-verification";
import { getMailConfig } from "./mail";

function mailEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values } as unknown as NodeJS.ProcessEnv;
}

test("mail stays disabled unless the complete runtime SMTP configuration is present", () => {
  assert.equal(getMailConfig(mailEnv({})), null);
  assert.equal(getMailConfig(mailEnv({
    MAIL_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "secret",
  })), null);
  assert.deepEqual(getMailConfig(mailEnv({
    MAIL_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_STARTTLS: "true",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "secret",
    MAIL_FROM: "noreply@example.com",
    MAIL_REPLY_TO: "support@example.com",
  })), {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    startTls: true,
    username: "mailer",
    password: "secret",
    from: "noreply@example.com",
    replyTo: "support@example.com",
  });
});

test("production email verification requires an explicit public site URL", () => {
  const env = process.env as unknown as Record<string, string | undefined>;
  const keys = [
    "NODE_ENV",
    "SITE_URL",
    "MAIL_ENABLED",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  Object.assign(env, {
    NODE_ENV: "production",
    MAIL_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "secret",
    MAIL_FROM: "noreply@example.com",
  });
  delete env.SITE_URL;
  try {
    assert.equal(isEmailVerificationConfigured(), false);
    env.SITE_URL = "https://reader.example.com";
    assert.equal(isEmailVerificationConfigured(), true);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});
