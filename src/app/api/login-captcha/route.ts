import { NextRequest, NextResponse } from "next/server";
import { getUserLoginCaptchaMode } from "@/lib/config";
import { createLoginCaptchaChallenge, type CaptchaPurpose } from "@/lib/login-captcha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let purpose: CaptchaPurpose;
  try {
    const body = (await request.json()) as { purpose?: string };
    if (body.purpose !== "login" && body.purpose !== "register") {
      return NextResponse.json({ message: "验证码用途无效" }, { status: 400 });
    }
    purpose = body.purpose;
  } catch {
    return NextResponse.json({ message: "验证码请求格式有误" }, { status: 400 });
  }

  const mode = getUserLoginCaptchaMode();
  if (mode === "off") {
    return NextResponse.json({ message: "验证码未开启" }, { status: 409 });
  }
  const response = NextResponse.json({ challenge: createLoginCaptchaChallenge(mode, purpose) });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
