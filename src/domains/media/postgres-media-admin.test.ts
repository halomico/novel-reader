import assert from "node:assert/strict";
import test from "node:test";
import type { SqlExecutor } from "@/core/db/postgres";
import { createPostgresVideoTag, MediaTagError, updatePostgresVideoTag } from "./postgres-media-admin";

test("video tags reject display prefixes and other special symbols before database access", async () => {
  let transactionStarted = false;
  await assert.rejects(
    createPostgresVideoTag("#剧情", "", async <T>(_operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> => {
      transactionStarted = true;
      throw new Error("unexpected transaction");
    }),
    MediaTagError,
  );
  assert.equal(transactionStarted, false);

  let queried = false;
  const executor: SqlExecutor = {
    async query() {
      queried = true;
      throw new Error("unexpected query");
    },
  };
  await assert.rejects(updatePostgresVideoTag(executor, 1, "科幻/冒险", "", 0, true), MediaTagError);
  assert.equal(queried, false);
});
