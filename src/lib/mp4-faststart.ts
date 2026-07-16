import fs from "node:fs";

export type Mp4AtomLayout = {
  moovOffset: number | null;
  mdatOffset: number | null;
  fastStart: boolean;
};

export function inspectMp4AtomLayout(filePath: string): Mp4AtomLayout {
  const fileSize = fs.statSync(filePath).size;
  const handle = fs.openSync(filePath, "r");
  let offset = 0;
  let moovOffset: number | null = null;
  let mdatOffset: number | null = null;
  const header = Buffer.alloc(16);

  try {
    for (let atoms = 0; atoms < 10_000 && offset + 8 <= fileSize; atoms += 1) {
      const bytesRead = fs.readSync(handle, header, 0, 16, offset);
      if (bytesRead < 8) {
        break;
      }
      const type = header.toString("ascii", 4, 8);
      const size32 = header.readUInt32BE(0);
      const headerSize = size32 === 1 ? 16 : 8;
      const atomSize = size32 === 0
        ? fileSize - offset
        : size32 === 1 && bytesRead >= 16
          ? Number(header.readBigUInt64BE(8))
          : size32;
      if (!Number.isSafeInteger(atomSize) || atomSize < headerSize || offset + atomSize > fileSize) {
        break;
      }
      if (type === "moov" && moovOffset === null) {
        moovOffset = offset;
      } else if (type === "mdat" && mdatOffset === null) {
        mdatOffset = offset;
      }
      offset += atomSize;
    }
  } finally {
    fs.closeSync(handle);
  }

  return {
    moovOffset,
    mdatOffset,
    fastStart: moovOffset !== null && (mdatOffset === null || moovOffset < mdatOffset),
  };
}
