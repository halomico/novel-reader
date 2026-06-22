import iconv from "iconv-lite";

export function decodeNovelBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  const text = utf8.includes("\uFFFD") ? iconv.decode(buffer, "gb18030") : utf8;
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
