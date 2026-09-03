import fs from "node:fs";
import path from "node:path";

type WidgetType = "face" | "ear" | "earrings" | "eyebrows" | "eyes" | "nose" | "glasses" | "mouth" | "beard" | "tops" | "clothes";
type AvatarWidget = { type: WidgetType; shape: string; fillColor?: string; zIndex?: number };

const WIDGET_ROOT = path.join(process.cwd(), "public", "avatar-widgets");
const COMMON_COLORS = ["#6BD9E9", "#FC909F", "#F4D150", "#E0DDFF", "#D2EFF3", "#FFEDEF", "#FFEBA4", "#506AF4", "#F48150", "#48A99A", "#C09FFF", "#FD6F5D"] as const;
const SKIN_COLORS = ["#F8D9CE", "#F9C9B6", "#DEB3A3", "#C89583", "#9C6458"] as const;
const BACKGROUND_COLORS = ["#6BD9E9", "#FC909F", "#F4D150", "#E0DDFF", "#D2EFF3", "#FFEDEF", "#FFEBA4", "#F48150", "#48A99A", "#C09FFF"] as const;
const SHAPES = {
  ear: ["attached", "detached"],
  earrings: ["hoop", "stud"],
  eyebrows: ["down", "eyelashesdown", "eyelashesup", "up"],
  eyes: ["ellipse", "eyeshadow", "round", "smiling"],
  nose: ["curve", "pointed", "round"],
  glasses: ["round", "square"],
  mouth: ["frown", "laughing", "nervous", "pucker", "sad", "smile", "smirk", "surprised"],
  maleTops: ["beanie", "clean", "fonze", "funny", "punk", "turban"],
  femaleTops: ["danny", "wave", "pixie"],
  clothes: ["collared", "crew", "open"],
} as const;
const LAYERS: Record<WidgetType, number> = {
  face: 10,
  eyes: 50,
  nose: 60,
  eyebrows: 70,
  tops: 80,
  glasses: 90,
  mouth: 100,
  ear: 102,
  earrings: 103,
  beard: 105,
  clothes: 110,
};
const fragmentCache = new Map<string, string>();

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function pick<Item>(items: readonly Item[], random: () => number): Item {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

function readWidget(type: WidgetType, shape: string, fillColor?: string): string {
  const cacheKey = `${type}/${shape}/${fillColor || "transparent"}`;
  const cached = fragmentCache.get(cacheKey);
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(WIDGET_ROOT, type, `${shape}.svg`), "utf8");
  const openEnd = raw.indexOf(">", raw.indexOf("<svg"));
  const closeStart = raw.lastIndexOf("</svg>");
  const fragment = raw.slice(openEnd + 1, closeStart).replaceAll("$fillColor", fillColor || "transparent");
  fragmentCache.set(cacheKey, fragment);
  return fragment;
}

/** Render one stable avatar using the MIT/CC BY licensed Vue Color Avatar
 * widget set. The route serving this output applies immutable HTTP caching. */
export function renderGeneratedAvatarSvg(seedValue: string): string {
  const random = seededRandom(hashSeed(seedValue));
  const female = random() >= .5;
  const skinColor = pick(SKIN_COLORS, random);
  const hairColor = pick(COMMON_COLORS, random);
  const widgets: AvatarWidget[] = [
    { type: "face", shape: "base", fillColor: skinColor },
    { type: "eyes", shape: pick(SHAPES.eyes, random) },
    { type: "nose", shape: pick(SHAPES.nose, random) },
    { type: "eyebrows", shape: pick(SHAPES.eyebrows, random) },
    { type: "tops", shape: pick(female ? SHAPES.femaleTops : SHAPES.maleTops, random), fillColor: hairColor },
    { type: "mouth", shape: pick(SHAPES.mouth, random) },
    { type: "ear", shape: pick(SHAPES.ear, random), fillColor: skinColor },
    { type: "clothes", shape: pick(SHAPES.clothes, random), fillColor: pick(COMMON_COLORS, random) },
  ];
  if (random() < .16) widgets.push({ type: "glasses", shape: pick(SHAPES.glasses, random) });
  if (random() < .13) widgets.push({ type: "earrings", shape: pick(SHAPES.earrings, random) });
  if (!female && random() < .08) widgets.push({ type: "beard", shape: "scruff", zIndex: LAYERS.mouth - 1 });
  widgets.sort((left, right) => (left.zIndex ?? LAYERS[left.type]) - (right.zIndex ?? LAYERS[right.type]));

  const payload = widgets.map((widget) => (
    `<g id="vue-color-avatar-${widget.type}">${readWidget(widget.type, widget.shape, widget.fillColor)}</g>`
  )).join("");
  const background = pick(BACKGROUND_COLORS, random);
  const border = random() < .12 ? pick(COMMON_COLORS, random) : "transparent";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated from Codennnn/vue-color-avatar widgets; see docs/third-party-assets.md. -->
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 400 400" fill="none">
  <title>vue-color-avatar</title>
  <defs><clipPath id="vue-color-avatar-frame"><rect width="400" height="400" rx="58" /></clipPath></defs>
  <g clip-path="url(#vue-color-avatar-frame)">
    <rect width="400" height="400" fill="${background}" />
    <g transform="translate(100, 65)">${payload}</g>
    <rect x="2" y="2" width="396" height="396" rx="56" stroke="${border}" stroke-width="4" />
  </g>
</svg>`;
}
