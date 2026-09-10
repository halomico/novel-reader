import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { PostgresUserProfile } from "@/domains/identity/postgres-users";
import { createOriginalDraftPublishHandler } from "./publish-route";
import { OriginalDraftError, type PublishDraftResult } from "./server";

const author: PostgresUserProfile = {
  id: 101,
  username: "author101",
  displayName: "Author 101",
  email: "author101@example.com",
  emailVerifiedAt: "2026-01-01T00:00:00Z",
  avatarPath: null,
  status: "active",
  role: "user",
  trustLevel: 5,
  sodaBalance: 1_000,
  sodaExperience: 500,
  cookieBalance: 1_000,
  localePreference: "zh-Hans",
  readingHistoryEnabled: true,
  originalReadingHistoryEnabled: true,
  registrationIp: "127.0.0.1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastLoginAt: "2026-01-01T00:00:00Z",
  lastLoginIp: "127.0.0.1",
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/original/drafts/7/publish", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      "x-novel-mutation": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("original publish route awaits the PostgreSQL publication transaction", async () => {
  let completed = false;
  const handler = createOriginalDraftPublishHandler({
    currentUser: async () => author,
    publish: async (): Promise<PublishDraftResult> => {
      await Promise.resolve();
      completed = true;
      return { articleId: 8, slug: "article-8", created: true, revisionNo: 1 };
    },
  });
  const response = await handler(
    request({ revision: 2, mutationId: "mutation_valid_1234567890abcdef" }),
    { params: Promise.resolve({ id: "7" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(completed, true);
  assert.deepEqual(await response.json(), { articleId: 8, slug: "article-8", created: true, revisionNo: 1 });
});

test("original publish route maps optimistic conflicts to HTTP 409", async () => {
  const handler = createOriginalDraftPublishHandler({
    currentUser: async () => author,
    publish: async () => {
      throw new OriginalDraftError("草稿已在其他页面更新", "conflict");
    },
  });
  const response = await handler(
    request({ revision: 2, mutationId: "mutation_conflict_1234567890abc" }),
    { params: Promise.resolve({ id: "7" }) },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "草稿已在其他页面更新" });
});

test("original publish route rejects unauthenticated requests before mutation", async () => {
  let called = false;
  const handler = createOriginalDraftPublishHandler({
    currentUser: async () => null,
    publish: async () => {
      called = true;
      return { articleId: 1, slug: "never", created: true, revisionNo: 1 };
    },
  });
  const response = await handler(
    request({ revision: 1, mutationId: "mutation_unauth_1234567890abcdef" }),
    { params: Promise.resolve({ id: "7" }) },
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
});
