import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const base = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3000";
const output = process.env.AUDIT_OUTPUT || "audit-artifacts/runtime-audit.json";
const browser = await chromium.launch({ headless: true });
const contexts = [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(1));
}

function summarize(values) {
  return {
    n: values.length,
    minMs: values.length ? Number(Math.min(...values).toFixed(1)) : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Number(Math.max(...values).toFixed(1)) : null,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  contexts: {},
};

for (const config of contexts) {
  const context = await browser.newContext({
    viewport: config.viewport,
    isMobile: config.isMobile,
    hasTouch: config.hasTouch,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text() });
  });
  page.on("pageerror", (error) => pageErrors.push({ url: page.url(), message: error.message }));
  page.on("requestfailed", (request) => requestFailures.push({
    page: page.url(),
    url: request.url(),
    method: request.method(),
    failure: request.failure()?.errorText || "unknown",
  }));

  const routes = [
    "/",
    "/novels",
    "/tags",
    "/search?q=%E4%BF%AE%E4%BB%99",
    "/original",
    "/announcements",
    "/media?kind=video",
    "/media?kind=audio",
    "/media?kind=file",
  ];
  const routeMetrics = {};
  for (const route of routes) {
    const samples = [];
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      const response = await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      samples.push(performance.now() - started);
      statuses.push(response?.status() ?? null);
    }
    routeMetrics[route] = { ...summarize(samples), statuses };
  }

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const nav = {};
  const novelsLink = page.locator('a[href$="/novels"], a[href*="/novels?"]').first();
  if (await novelsLink.count()) {
    const started = performance.now();
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith("/novels"), { timeout: 15_000 }),
      novelsLink.click(),
    ]);
    nav.homeToNovelsUrlCommitMs = Number((performance.now() - started).toFixed(1));
    const settled = performance.now();
    await page.waitForLoadState("domcontentloaded");
    nav.homeToNovelsDomSettledExtraMs = Number((performance.now() - settled).toFixed(1));
  } else {
    nav.homeToNovelsUrlCommitMs = null;
    nav.homeToNovelsMissing = true;
  }

  await page.goto(`${base}/search?q=%E4%BF%AE%E4%BB%99`, { waitUntil: "domcontentloaded" });
  async function postSearch(pageNumber) {
    return page.evaluate(async ({ pageNumber }) => {
      const started = performance.now();
      const response = await fetch("/api/search/content", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ q: "修仙", library: "default", page: pageNumber }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      return {
        elapsedMs: performance.now() - started,
        status: response.status,
        ok: response.ok && data.ok === true,
        totalItems: data.totalItems ?? null,
        totalNovels: data.totalNovels ?? null,
        totalPages: data.totalPages ?? null,
        itemCount: Array.isArray(data.items) ? data.items.length : null,
        firstNovelId: Array.isArray(data.items) && data.items.length ? data.items[0].novelId : null,
        message: data.message ?? null,
      };
    }, { pageNumber });
  }

  const searchPages = [1, 2, 10, 50, 100];
  const search = {};
  for (const pageNumber of searchPages) {
    const results = [];
    for (let i = 0; i < 8; i += 1) results.push(await postSearch(pageNumber));
    search[`page${pageNumber}`] = {
      latency: summarize(results.map((item) => item.elapsedMs)),
      statuses: [...new Set(results.map((item) => item.status))],
      ok: results.every((item) => item.ok),
      totalItems: results[0]?.totalItems ?? null,
      totalNovels: results[0]?.totalNovels ?? null,
      totalPages: results[0]?.totalPages ?? null,
      itemCount: results[0]?.itemCount ?? null,
      message: results.find((item) => item.message)?.message ?? null,
    };
  }

  const rapidPagination = [];
  await page.goto(`${base}/search?q=%E4%BF%AE%E4%BB%99`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('.searchResults, .emptyState, [role="alert"]', { timeout: 20_000 });
    for (let i = 0; i < 8; i += 1) {
      const next = page.getByRole("button", { name: "下一页" });
      if (!(await next.count())) break;
      const responsePromise = page.waitForResponse((response) => response.url().includes("/api/search/content") && response.request().method() === "POST", { timeout: 20_000 });
      const started = performance.now();
      await next.click();
      const response = await responsePromise;
      rapidPagination.push({ page: i + 2, elapsedMs: Number((performance.now() - started).toFixed(1)), status: response.status() });
    }
  } catch (error) {
    rapidPagination.push({ error: error instanceof Error ? error.message : String(error) });
  }

  const first = await postSearch(1);
  const detailMetrics = {};
  if (first.firstNovelId) {
    for (const path of [`/books/${first.firstNovelId}`, `/books/${first.firstNovelId}?from=${encodeURIComponent("/search?q=修仙")}`]) {
      const times = [];
      const statuses = [];
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        times.push(performance.now() - started);
        statuses.push(response?.status() ?? null);
      }
      detailMetrics[path] = { ...summarize(times), statuses };
    }
  }

  report.contexts[config.name] = {
    viewport: config.viewport,
    routes: routeMetrics,
    navigation: nav,
    search,
    rapidPagination,
    detail: detailMetrics,
    consoleErrors,
    pageErrors,
    requestFailures,
  };
  await context.close();
}

await browser.close();
await fs.mkdir(new URL(".", `file://${process.cwd()}/${output}`).pathname, { recursive: true }).catch(() => undefined);
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.contexts).some((value) => value.pageErrors.length > 0)) process.exitCode = 2;
