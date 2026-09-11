import assert from "node:assert/strict";
import test from "node:test";
import {
  createOriginalEditorTag,
  deleteOriginalDraftForAuthor,
  deleteOriginalDraftsForAuthor,
  getOriginalDraftForAuthor,
  OriginalDraftError,
  saveOriginalDraft,
} from "./server";

test("original editor rejects malformed identities and tags before database access", async () => {
  assert.equal(await getOriginalDraftForAuthor(0, 1), null);
  assert.equal(await deleteOriginalDraftForAuthor(1, 0), false);
  assert.equal(await deleteOriginalDraftsForAuthor([], 1), 0);
  await assert.rejects(
    deleteOriginalDraftsForAuthor([0], 1),
    (error: unknown) => error instanceof OriginalDraftError && error.code === "invalid",
  );
  await assert.rejects(
    deleteOriginalDraftsForAuthor(Array.from({ length: 101 }, (_, index) => index + 1), 1),
    (error: unknown) => error instanceof OriginalDraftError && error.code === "invalid",
  );
  await assert.rejects(
    createOriginalEditorTag({ name: "bad tag", authorId: 1 }),
    (error: unknown) => error instanceof OriginalDraftError && error.code === "invalid",
  );
  await assert.rejects(
    createOriginalEditorTag({ name: "阅读", authorId: 0 }),
    (error: unknown) => error instanceof OriginalDraftError && error.code === "forbidden",
  );
});

test("original editor enforces the four-megabyte autosave boundary before a write", async () => {
  await assert.rejects(
    saveOriginalDraft({
      draftId: 1,
      authorId: 1,
      revision: 1,
      title: "边界测试",
      editorStateJson: "A".repeat(4 * 1024 * 1024 + 1),
      tagIds: [],
      unlockSodaPrice: 0,
    }),
    (error: unknown) => error instanceof OriginalDraftError &&
      error.message.includes("文章内容超过草稿保存上限"),
  );
});

test("draft DELETE route permits mutation without content-type and does not return 415 unsupported_media_type", async () => {
  const { NextRequest } = await import("next/server");
  const { DELETE: draftDeleteRoute } = await import("@/app/api/original/drafts/[id]/route");
  const req = new NextRequest("http://127.0.0.1:3000/api/original/drafts/123", {
    method: "DELETE",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      "x-novel-mutation": "1",
    },
  });
  const response = await draftDeleteRoute(req, { params: Promise.resolve({ id: "123" }) });
  assert.notEqual(response.status, 415);
  assert.equal(response.status, 401);
});

test("draft batch DELETE route validates authentication before mutation", async () => {
  const { NextRequest } = await import("next/server");
  const { DELETE: batchDeleteRoute } = await import("@/app/api/original/drafts/route");
  const req = new NextRequest("http://127.0.0.1:3000/api/original/drafts", {
    method: "DELETE",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-novel-mutation": "1",
    },
    body: JSON.stringify({ ids: [1, 2] }),
  });
  const response = await batchDeleteRoute(req);
  assert.equal(response.status, 401);
});
