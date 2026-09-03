import sharp from "sharp";
import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { storeOriginalAsset } from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 1_600;

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request, { requireJson: false });
  if (guard) return guard;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "图片请求格式无效" }, { status: 400 });
  }
  const image = formData.get("image");
  if (!(image instanceof File) || image.size <= 0) {
    return NextResponse.json({ error: "请选择图片" }, { status: 400 });
  }
  if (image.size > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "图片不能超过 10 MB" }, { status: 413 });
  }
  try {
    const source = Buffer.from(await image.arrayBuffer());
    const probe = sharp(source, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const metadata = await probe.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      return NextResponse.json({ error: "图片尺寸无效或像素过大" }, { status: 400 });
    }
    const rendered = await probe
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const asset = await storeOriginalAsset({
      ownerId: user.id,
      bytes: rendered.data,
      width: rendered.info.width,
      height: rendered.info.height,
      mimeType: "image/webp",
    });
    return NextResponse.json({ asset }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to process original image", error);
    return NextResponse.json({ error: "图片无法解码或处理" }, { status: 400 });
  }
}
