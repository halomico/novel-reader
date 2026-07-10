import crypto from "node:crypto";
import { deflateSync } from "node:zlib";
import type { UserLoginCaptchaMode } from "./site-settings";

const CAPTCHA_TTL_MS = 5 * 60 * 1_000;
const CAPTCHA_STORE_LIMIT = 2_000;
const SLIDER_WIDTH = 320;
const SLIDER_HEIGHT = 150;
const SLIDER_PIECE_SIZE = 52;

type ActiveCaptchaMode = Exclude<UserLoginCaptchaMode, "off">;
export type CaptchaPurpose = "login" | "register";

type StoredChallenge = {
  mode: ActiveCaptchaMode;
  purpose: CaptchaPurpose;
  answer: string;
  expiresAt: number;
};

type CaptchaGlobal = typeof globalThis & {
  novelLoginCaptchaChallenges?: Map<string, StoredChallenge>;
};

export type LoginCaptchaChallenge = {
  id: string;
  mode: ActiveCaptchaMode;
  imageUrl: string;
  sliderPieceImageUrl?: string;
  sliderWidth?: number;
  sliderHeight?: number;
  sliderPieceSize?: number;
  sliderPieceTop?: number;
  sliderMaxPosition?: number;
};

function challengeStore(): Map<string, StoredChallenge> {
  const globalForCaptcha = globalThis as CaptchaGlobal;
  globalForCaptcha.novelLoginCaptchaChallenges ||= new Map();
  return globalForCaptcha.novelLoginCaptchaChallenges;
}

function pruneChallenges(now: number) {
  const store = challengeStore();
  for (const [id, challenge] of store) {
    if (challenge.expiresAt <= now) {
      store.delete(id);
    }
  }
  while (store.size >= CAPTCHA_STORE_LIMIT) {
    const firstId = store.keys().next().value as string | undefined;
    if (!firstId) {
      break;
    }
    store.delete(firstId);
  }
}

function randomCode(length: number): string {
  const alphabet = "23456789ABCDEFGH";
  return Array.from({ length }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join("");
}

type Rgb = readonly [number, number, number];

const CAPTCHA_GLYPHS: Record<string, number[]> = {
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 16, 30, 1, 1, 30],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 19, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function createPixels(width: number, height: number, color: Rgb): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
  return pixels;
}

function setPixel(pixels: Buffer, width: number, height: number, x: number, y: number, color: Rgb) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const offset = (Math.floor(y) * width + Math.floor(x)) * 3;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function fillRect(pixels: Buffer, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: Rgb) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      setPixel(pixels, width, height, column, row, color);
    }
  }
}

function drawLine(pixels: Buffer, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: Rgb) {
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setPixel(pixels, width, height, x, y, color);
    if (x === x2 && y === y2) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function fillCircle(pixels: Buffer, width: number, height: number, centerX: number, centerY: number, radius: number, color: Rgb) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) {
        setPixel(pixels, width, height, centerX + x, centerY + y, color);
      }
    }
  }
}

function drawGlyph(pixels: Buffer, width: number, height: number, glyph: number[], x: number, y: number, color: Rgb, shear: number) {
  const scale = 4;
  glyph.forEach((rowMask, row) => {
    for (let column = 0; column < 5; column += 1) {
      if ((rowMask & (1 << (4 - column))) !== 0) {
        fillRect(pixels, width, height, x + column * scale + (row - 3) * shear, y + row * scale, scale, scale, color);
      }
    }
  });
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function pngDataUrl(width: number, height: number, pixels: Buffer, channels: 3 | 4 = 3): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (rowBytes + 1);
    raw[targetOffset] = 0;
    pixels.copy(raw, targetOffset + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function imageCaptchaPng(answer: string): string {
  const width = 160;
  const height = 54;
  const pixels = createPixels(width, height, [242, 238, 232]);
  for (let index = 0; index < 18; index += 1) {
    fillCircle(
      pixels,
      width,
      height,
      crypto.randomInt(4, width - 4),
      crypto.randomInt(4, height - 4),
      crypto.randomInt(1, 3),
      [205, 181, 169],
    );
  }
  for (let index = 0; index < 6; index += 1) {
    drawLine(
      pixels,
      width,
      height,
      crypto.randomInt(0, width),
      crypto.randomInt(0, height),
      crypto.randomInt(0, width),
      crypto.randomInt(0, height),
      [151, 137, 126],
    );
  }
  answer.split("").forEach((letter, index) => {
    drawGlyph(
      pixels,
      width,
      height,
      CAPTCHA_GLYPHS[letter],
      15 + index * 37,
      12 + crypto.randomInt(-2, 3),
      index % 2 === 0 ? [126, 44, 38] : [49, 86, 107],
      crypto.randomInt(-1, 2),
    );
  });
  return pngDataUrl(width, height, pixels);
}

function mixColor(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function sliderScenePixels(): Buffer {
  const pixels = createPixels(SLIDER_WIDTH, SLIDER_HEIGHT, [103, 157, 170]);
  for (let y = 0; y < SLIDER_HEIGHT; y += 1) {
    const color = mixColor([68, 132, 153], [218, 218, 190], y / (SLIDER_HEIGHT - 1));
    fillRect(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 0, y, SLIDER_WIDTH, 1, color);
  }

  fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 264, 30, 16, [246, 219, 151]);
  fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 78, 29, 12, [229, 232, 221]);
  fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 92, 27, 16, [237, 238, 226]);
  fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 108, 31, 11, [229, 232, 221]);

  for (let x = 0; x < SLIDER_WIDTH; x += 1) {
    const farRidge = Math.round(62 + Math.sin(x / 31) * 9 + Math.sin(x / 13) * 4);
    for (let y = farRidge; y < 116; y += 1) {
      setPixel(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x, y, [104, 134, 123]);
    }
    const nearRidge = Math.round(84 + Math.sin((x + 27) / 24) * 10 + Math.sin(x / 9) * 3);
    for (let y = nearRidge; y < 118; y += 1) {
      setPixel(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x, y, [61, 102, 88]);
    }
  }

  for (let y = 110; y < SLIDER_HEIGHT; y += 1) {
    const color = mixColor([91, 143, 148], [43, 88, 101], (y - 110) / 40);
    fillRect(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 0, y, SLIDER_WIDTH, 1, color);
  }
  fillRect(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, 0, 107, SLIDER_WIDTH, 5, [48, 83, 72]);
  for (let index = 0; index < 18; index += 1) {
    const y = crypto.randomInt(115, SLIDER_HEIGHT - 2);
    const x = crypto.randomInt(0, SLIDER_WIDTH - 28);
    drawLine(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x, y, x + crypto.randomInt(10, 29), y, [139, 174, 169]);
  }
  for (const x of [24, 48, 286, 305]) {
    fillRect(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x - 1, 78, 3, 32, [66, 62, 48]);
    fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x, 76, 10, [45, 91, 71]);
    fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x - 6, 84, 8, [53, 105, 76]);
    fillCircle(pixels, SLIDER_WIDTH, SLIDER_HEIGHT, x + 6, 84, 8, [40, 84, 67]);
  }
  return pixels;
}

function isInsideSliderPiece(x: number, y: number): boolean {
  const edge = 8;
  const farEdge = SLIDER_PIECE_SIZE - 9;
  const radius = 7;
  const inBase = x >= edge && x <= farEdge && y >= edge && y <= farEdge;
  const topBump = (x - 31) ** 2 + (y - edge) ** 2 <= radius ** 2 && y <= edge + radius;
  const rightBump = (x - farEdge) ** 2 + (y - 30) ** 2 <= radius ** 2 && x >= farEdge - radius;
  const leftNotch = (x - edge) ** 2 + (y - 32) ** 2 < radius ** 2 && x <= edge + radius;
  const bottomNotch = (x - 25) ** 2 + (y - farEdge) ** 2 < radius ** 2 && y >= farEdge - radius;
  return (inBase || topBump || rightBump) && !leftNotch && !bottomNotch;
}

function isSliderPieceEdge(x: number, y: number): boolean {
  if (!isInsideSliderPiece(x, y)) {
    return false;
  }
  return (
    !isInsideSliderPiece(x - 1, y) ||
    !isInsideSliderPiece(x + 1, y) ||
    !isInsideSliderPiece(x, y - 1) ||
    !isInsideSliderPiece(x, y + 1)
  );
}

function sliderCaptchaPng(targetX: number, targetY: number): { background: string; piece: string } {
  const source = sliderScenePixels();
  const background = Buffer.from(source);
  const piece = Buffer.alloc(SLIDER_PIECE_SIZE * SLIDER_PIECE_SIZE * 4);
  const holeColor: Rgb = [40, 55, 59];

  for (let y = 0; y < SLIDER_PIECE_SIZE; y += 1) {
    for (let x = 0; x < SLIDER_PIECE_SIZE; x += 1) {
      if (!isInsideSliderPiece(x, y)) {
        continue;
      }
      const sourceOffset = ((targetY + y) * SLIDER_WIDTH + targetX + x) * 3;
      const pieceOffset = (y * SLIDER_PIECE_SIZE + x) * 4;
      const edge = isSliderPieceEdge(x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = source[sourceOffset + channel];
        piece[pieceOffset + channel] = edge ? Math.min(255, sourceValue + 30) : sourceValue;
        background[sourceOffset + channel] = edge
          ? holeColor[channel]
          : Math.round(sourceValue * 0.22 + holeColor[channel] * 0.78);
      }
      piece[pieceOffset + 3] = 255;
    }
  }

  return {
    background: pngDataUrl(SLIDER_WIDTH, SLIDER_HEIGHT, background),
    piece: pngDataUrl(SLIDER_PIECE_SIZE, SLIDER_PIECE_SIZE, piece, 4),
  };
}

export function createLoginCaptchaChallenge(
  mode: ActiveCaptchaMode,
  purpose: CaptchaPurpose,
  now = Date.now(),
): LoginCaptchaChallenge {
  pruneChallenges(now);
  const id = crypto.randomBytes(18).toString("base64url");
  if (mode === "image") {
    const answer = randomCode(4);
    challengeStore().set(id, { mode, purpose, answer, expiresAt: now + CAPTCHA_TTL_MS });
    return { id, mode, imageUrl: imageCaptchaPng(answer) };
  }

  const targetX = crypto.randomInt(68, SLIDER_WIDTH - SLIDER_PIECE_SIZE - 14);
  const targetY = crypto.randomInt(28, SLIDER_HEIGHT - SLIDER_PIECE_SIZE - 10);
  const images = sliderCaptchaPng(targetX, targetY);
  challengeStore().set(id, { mode, purpose, answer: String(targetX), expiresAt: now + CAPTCHA_TTL_MS });
  return {
    id,
    mode,
    imageUrl: images.background,
    sliderPieceImageUrl: images.piece,
    sliderWidth: SLIDER_WIDTH,
    sliderHeight: SLIDER_HEIGHT,
    sliderPieceSize: SLIDER_PIECE_SIZE,
    sliderPieceTop: targetY,
    sliderMaxPosition: SLIDER_WIDTH - SLIDER_PIECE_SIZE,
  };
}

export function loginCaptchaAnswersMatch(mode: ActiveCaptchaMode, expected: string, provided: string): boolean {
  if (mode === "image") {
    return provided.trim().toUpperCase() === expected;
  }
  const expectedPosition = Number(expected);
  const providedPosition = Number(provided);
  return Number.isFinite(providedPosition) && Math.abs(providedPosition - expectedPosition) <= 5;
}

export function verifyLoginCaptcha(params: {
  id: string;
  mode: ActiveCaptchaMode;
  purpose: CaptchaPurpose;
  answer: string;
  now?: number;
}): boolean {
  const store = challengeStore();
  const challenge = store.get(params.id);
  store.delete(params.id);
  const now = params.now ?? Date.now();
  if (
    !challenge ||
    challenge.expiresAt <= now ||
    challenge.mode !== params.mode ||
    challenge.purpose !== params.purpose
  ) {
    return false;
  }
  return loginCaptchaAnswersMatch(challenge.mode, challenge.answer, params.answer);
}
