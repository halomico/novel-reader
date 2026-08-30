import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  encodeEntitlementDefinition,
  entitlementTargetExists,
  getEntitlementTargetOption,
  grantUserEntitlement,
  hasNovelReadEntitlement,
  listEntitlementTargets,
  listUserEntitlementsPage,
} from "./entitlements";
import {
  createMarketProduct,
  createRedemptionCodeBatch,
  deleteMarketProduct,
  getUserMarketOrder,
  getMarketProductById,
  importMarketSecrets,
  listAdminMarketOrders,
  listMarketOrderDeliveries,
  listMarketProducts,
  listUserMarketOrders,
  purchaseMarketProduct,
  redeemMarketCode,
  removeAdminMarketOrder,
  replaceMarketProductCover,
  revealOrderDeliveryContent,
  saveMarketDeliveryItem,
  updateMarketProduct,
} from "./market";
import {
  consumeRegistrationInviteInCurrentTransaction,
  createRegistrationInvites,
  listRegistrationInvites,
} from "./registration-invites";
import { exchangeUserCurrency } from "./user-wallet";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const previousMarketSecret = process.env.MARKET_SECRET_KEY;
  const previousInviteSecret = process.env.REGISTRATION_INVITE_SECRET;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-market-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  process.env.MARKET_SECRET_KEY = "market-test-secret-0123456789abcdef";
  process.env.REGISTRATION_INVITE_SECRET = "invite-test-secret-0123456789abcdef";
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    if (previousMarketSecret === undefined) delete process.env.MARKET_SECRET_KEY;
    else process.env.MARKET_SECRET_KEY = previousMarketSecret;
    if (previousInviteSecret === undefined) delete process.env.REGISTRATION_INVITE_SECRET;
    else process.env.REGISTRATION_INVITE_SECRET = previousInviteSecret;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("market purchase atomically charges currency and snapshots encrypted delivery", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare(
      `INSERT INTO users (
         username, display_name, password_hash, trust_level,
         soda_balance, soda_experience, cookie_balance
       )
       VALUES ('buyer', '购买者', 'hash', 2, 0, 50, 20)`,
    )
    .run().lastInsertRowid);
  const productId = createMarketProduct({
    slug: "access-card",
    title: "访问卡",
    priceCookie: 3,
    minLevel: 2,
    purchaseLimitPerUser: 1,
  });
  saveMarketDeliveryItem({
    productId,
    kind: "text",
    title: "说明",
    content: "仅向订单持有人展示。",
  });
  saveMarketDeliveryItem({
    productId,
    kind: "secret",
    title: "卡密",
    sortOrder: 10,
  });
  assert.equal(importMarketSecrets(productId, ["SECRET-001"]), 1);
  const product = getMarketProductById(productId)!;
  assert.equal(updateMarketProduct({
    id: productId,
    slug: product.slug,
    title: product.title,
    description: product.description,
    status: "published",
    minLevel: product.minLevel,
    priceCookie: product.priceCookie,
    priceSoda: product.priceSoda,
    purchaseLimitPerUser: product.purchaseLimitPerUser,
    sortOrder: product.sortOrder,
  }), true);

  const order = purchaseMarketProduct({ userId, productId, currency: "cookie" });
  assert.equal(order.status, "fulfilled");
  assert.equal(getMarketProductById(productId)?.salesCount, 1);
  assert.equal(
    (db.prepare("SELECT cookie_balance FROM users WHERE id = ?").get(userId) as { cookie_balance: number }).cookie_balance,
    17,
  );
  const deliveries = listMarketOrderDeliveries(order.id);
  const secret = deliveries.find((delivery) => delivery.kind === "secret")!;
  assert.notEqual(secret.content, "SECRET-001");
  assert.equal(revealOrderDeliveryContent(secret), "SECRET-001");
  assert.equal(getMarketProductById(productId)?.stock, 0);
  assert.equal(listAdminMarketOrders()[0]?.id, order.id);
  assert.equal(removeAdminMarketOrder(order.id), true);
  assert.equal(listAdminMarketOrders().length, 0);
  assert.equal(listUserMarketOrders(userId)[0]?.id, order.id);
  assert.equal(getUserMarketOrder(userId, order.orderNo)?.id, order.id);
  assert.throws(
    () => purchaseMarketProduct({ userId, productId, currency: "cookie" }),
    /购买次数上限/,
  );
});

test("market products generate unique slugs, retain cover metadata, and soft delete", (t) => {
  withTempDatabase(t);
  assert.throws(
    () => createMarketProduct({
      slug: "two-currencies",
      title: "双币商品",
      priceCookie: 1,
      priceSoda: 10,
    }),
    /只能选择一种支付方式/,
  );
  const firstId = createMarketProduct({ slug: "", title: "中文商品" });
  const secondId = createMarketProduct({ slug: "", title: "中文商品" });
  const first = getMarketProductById(firstId)!;
  const second = getMarketProductById(secondId)!;

  assert.match(first.slug, /^item-[a-f0-9]{10}$/);
  assert.match(second.slug, /^item-[a-f0-9]{10}$/);
  assert.notEqual(first.slug, second.slug);

  const coverKey = "a".repeat(32);
  assert.equal(replaceMarketProductCover(firstId, {
    key: coverKey,
    storageNodeId: "media-a",
  }), undefined);
  assert.equal(getMarketProductById(firstId)?.coverKey, coverKey);
  assert.equal(getMarketProductById(firstId)?.coverStorageNodeId, "media-a");

  assert.equal(deleteMarketProduct(firstId), true);
  assert.equal(getMarketProductById(firstId), null);
  assert.deepEqual(
    listMarketProducts({ includeUnpublished: true }).map((product) => product.id),
    [secondId],
  );
});

test("redemption codes store only hashes and currency exchange updates both ledgers atomically", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare(
      `INSERT INTO users (
         username, display_name, password_hash, trust_level,
         soda_balance, soda_experience, cookie_balance
       )
       VALUES ('redeemer', '兑换者', 'hash', 2, 0, 50, 2)`,
    )
    .run().lastInsertRowid);
  const { codes } = createRedemptionCodeBatch({
    name: "曲奇充值",
    rewardType: "cookie",
    rewardAmount: 5,
    count: 1,
  });
  assert.equal(codes.length, 1);
  assert.equal(
    JSON.stringify(db.prepare("SELECT * FROM redemption_codes").all()).includes(codes[0]),
    false,
  );
  assert.deepEqual(redeemMarketCode(userId, codes[0]), {
    rewardType: "cookie",
    amount: 5,
    orderNo: undefined,
  });
  assert.throws(() => redeemMarketCode(userId, codes[0]), /已使用/);

  assert.deepEqual(exchangeUserCurrency({
    userId,
    direction: "cookie-to-soda",
    sourceAmount: 2,
    sodaPerCookie: 10,
  }), {
    cookieBalance: 5,
    sodaBalance: 20,
    receivedAmount: 20,
  });
  assert.deepEqual(
    { ...(db.prepare(
      "SELECT cookie_balance, soda_balance, soda_experience, trust_level FROM users WHERE id = ?",
    ).get(userId) as object) },
    { cookie_balance: 5, soda_balance: 20, soda_experience: 70, trust_level: 2 },
  );
  assert.deepEqual(
    db.prepare(
      `SELECT currency, amount FROM user_currency_transactions
       WHERE source = 'currency_exchange' ORDER BY id`,
    ).all().map((row) => ({ ...row })),
    [
      { currency: "cookie", amount: -2 },
      { currency: "soda", amount: 20 },
    ],
  );

  assert.throws(
    () => exchangeUserCurrency({
      userId,
      direction: "soda-to-cookie",
      sourceAmount: 3,
      sodaPerCookie: 10,
    }),
    /苏打数量须为 10 的倍数/,
  );
  assert.throws(
    () => exchangeUserCurrency({
      userId,
      direction: "soda-to-cookie",
      sourceAmount: 30,
      sodaPerCookie: 10,
    }),
    /苏打不足/,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'currency_exchange'")
      .get() as { count: number }).count,
    2,
  );
  assert.deepEqual(exchangeUserCurrency({
    userId,
    direction: "soda-to-cookie",
    sourceAmount: 10,
    sodaPerCookie: 10,
  }), {
    cookieBalance: 6,
    sodaBalance: 10,
    receivedAmount: 1,
  });
  assert.deepEqual(
    { ...(db.prepare(
      "SELECT cookie_balance, soda_balance, soda_experience, trust_level FROM users WHERE id = ?",
    ).get(userId) as object) },
    { cookie_balance: 6, soda_balance: 10, soda_experience: 70, trust_level: 2 },
  );
  assert.deepEqual(
    db.prepare(
      `SELECT currency, amount FROM user_currency_transactions
       WHERE source = 'currency_exchange' ORDER BY id`,
    ).all().map((row) => ({ ...row })),
    [
      { currency: "cookie", amount: -2 },
      { currency: "soda", amount: 20 },
      { currency: "soda", amount: -10 },
      { currency: "cookie", amount: 1 },
    ],
  );
});

test("registration invitation usage is bounded and raw codes are never persisted", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const [code] = createRegistrationInvites({ label: "测试", count: 1, maxUses: 1 });
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM registration_invites").all()).includes(code), false);
  db.exec("BEGIN IMMEDIATE");
  assert.equal(consumeRegistrationInviteInCurrentTransaction(code), true);
  db.exec("COMMIT");
  db.exec("BEGIN IMMEDIATE");
  assert.equal(consumeRegistrationInviteInCurrentTransaction(code), false);
  db.exec("ROLLBACK");
  assert.equal(listRegistrationInvites()[0].usedCount, 1);
});

test("market purchases grant typed library entitlements", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance) VALUES ('entitled', 'Entitled', 'hash', 2, 10)",
  ).run().lastInsertRowid);
  const sourceId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('premium', 'Premium', 'premium')",
  ).run().lastInsertRowid);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (
       title, file_name, relative_path, source_id, access_mode, soda_price, size_bytes, mtime_ms
     ) VALUES ('Premium book', 'premium.txt', 'premium/premium.txt', ?, 'soda', 5, 10, 1)`,
  ).run(sourceId).lastInsertRowid);
  const productId = createMarketProduct({
    slug: "premium-library",
    title: "Premium library",
    priceSoda: 4,
  });
  saveMarketDeliveryItem({
    productId,
    kind: "entitlement",
    title: "Library access",
    content: encodeEntitlementDefinition({
      targetType: "novel_source",
      targetId: String(sourceId),
      rights: ["read"],
      durationSeconds: 3600,
    }),
  });
  const product = getMarketProductById(productId)!;
  updateMarketProduct({
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    status: "published",
    minLevel: product.minLevel,
    priceCookie: product.priceCookie,
    priceSoda: product.priceSoda,
    purchaseLimitPerUser: product.purchaseLimitPerUser,
    sortOrder: product.sortOrder,
  });

  const order = purchaseMarketProduct({ userId, productId, currency: "soda" });
  assert.equal(order.status, "fulfilled");
  assert.equal(hasNovelReadEntitlement(userId, novelId, sourceId), true);
  const entitlement = db.prepare(
    "SELECT resource_type, resource_id, rights, source_order_id, expires_at FROM user_entitlements WHERE user_id = ?",
  ).get(userId) as {
    resource_type: string;
    resource_id: string;
    rights: string;
    source_order_id: number;
    expires_at: string | null;
  };
  assert.equal(entitlement.resource_type, "novel_source");
  assert.equal(entitlement.resource_id, String(sourceId));
  assert.equal(JSON.parse(entitlement.rights).includes("read"), true);
  assert.equal(entitlement.source_order_id, order.id);
  assert.equal(Date.parse(entitlement.expires_at || "") > Date.now(), true);
});

test("media entitlements resolve folders from stored media paths", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level)
     VALUES ('media-buyer', '媒体用户', 'hash', 2)`,
  ).run().lastInsertRowid);
  const mediaId = Number(db.prepare(
    `INSERT INTO media_assets (
       kind, title, file_name, stored_name, mime_type, size_bytes
     ) VALUES ('audio', '测试音频', 'track.mp3', 'audio/专辑/track.mp3', 'audio/mpeg', 1024)`,
  ).run().lastInsertRowid);

  grantUserEntitlement({
    userId,
    definition: {
      targetType: "audio",
      targetId: String(mediaId),
      rights: ["play"],
      durationSeconds: null,
    },
  });

  assert.equal(getEntitlementTargetOption("audio", String(mediaId))?.meta, "专辑 / track.mp3");
  assert.deepEqual(
    listEntitlementTargets("audio_folder").map((item) => ({ ...item })),
    [{ id: "专辑", label: "专辑", meta: "1 项" }],
  );
  assert.equal(entitlementTargetExists({
    targetType: "audio_folder",
    targetId: "专辑",
    rights: ["play"],
    durationSeconds: null,
  }), true);
  assert.equal(listUserEntitlementsPage(userId).items[0]?.targetLabel, "测试音频");
});
