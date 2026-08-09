export const BOOKS_PER_SITEMAP = 40_000;

export type SitemapUrl = {
  url: string;
  lastModified?: string | Date | null;
  changeFrequency?: "daily" | "weekly" | "monthly";
  priority?: number;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatLastModified(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getBookSitemapPageCount(bookCount: number): number {
  return Math.max(1, Math.ceil(Math.max(0, bookCount) / BOOKS_PER_SITEMAP));
}

export function parseBookSitemapPage(value: string, pageCount: number): number | null {
  const match = /^([1-9]\d*)\.xml$/.exec(value);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page <= pageCount ? page : null;
}

export function renderSitemapIndex(urls: string[]): string {
  const items = urls.map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`;
}

export function renderUrlSet(entries: SitemapUrl[]): string {
  const items = entries.map((entry) => {
    const lastModified = formatLastModified(entry.lastModified);
    return [
      "<url>",
      `<loc>${escapeXml(entry.url)}</loc>`,
      lastModified ? `<lastmod>${lastModified}</lastmod>` : "",
      entry.changeFrequency ? `<changefreq>${entry.changeFrequency}</changefreq>` : "",
      entry.priority === undefined ? "" : `<priority>${entry.priority}</priority>`,
      "</url>",
    ].join("");
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`;
}

export function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
