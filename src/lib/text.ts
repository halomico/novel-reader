import { isUtf8 } from "node:buffer";
import iconv from "iconv-lite";

export function decodeNovelBuffer(buffer: Buffer): string {
  const text = isUtf8(buffer) ? buffer.toString("utf8") : iconv.decode(buffer, "gb18030");
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
