"use client";

import { ChevronsRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { LoginCaptchaChallenge } from "@/lib/login-captcha";

export function LoginCaptcha({ challenge }: { challenge: LoginCaptchaChallenge }) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [sliderPosition, setSliderPosition] = useState(0);

  useEffect(() => {
    setSliderPosition(0);
  }, [challenge.id]);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  const refreshButton = (
    <button
      className="loginCaptchaRefresh"
      type="button"
      onClick={refresh}
      disabled={isRefreshing}
      aria-label="更换验证码"
      title="更换验证码"
    >
      <RefreshCw size={15} aria-hidden="true" />
    </button>
  );

  if (challenge.mode === "image") {
    return (
      <div className="loginCaptcha">
        <input name="captchaId" type="hidden" value={challenge.id} />
        <div className="loginCaptchaHeader">
          <span>图形验证码</span>
          {refreshButton}
        </div>
        <div className="loginCaptchaImageRow">
          <img src={challenge.imageUrl} alt="图形验证码" width="160" height="54" />
          <input
            name="captchaAnswer"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={4}
            required
            aria-label="输入图形验证码"
          />
        </div>
      </div>
    );
  }

  const sliderWidth = challenge.sliderWidth || 320;
  const sliderHeight = challenge.sliderHeight || 150;
  const pieceSize = challenge.sliderPieceSize || 52;
  const pieceTop = challenge.sliderPieceTop || 0;
  const maxPosition = challenge.sliderMaxPosition || sliderWidth - pieceSize;
  const progress = Math.min(100, Math.max(0, (sliderPosition / maxPosition) * 100));
  return (
    <div className="loginCaptcha">
      <input name="captchaId" type="hidden" value={challenge.id} />
      <div className="loginCaptchaHeader">
        <span>安全验证</span>
        {refreshButton}
      </div>
      <div className="loginCaptchaSliderCanvas">
        <img
          className="loginCaptchaSliderBackground"
          src={challenge.imageUrl}
          alt="拼图验证码背景"
          width={sliderWidth}
          height={sliderHeight}
          draggable={false}
        />
        {challenge.sliderPieceImageUrl ? (
          <img
            className="loginCaptchaSliderPiece"
            src={challenge.sliderPieceImageUrl}
            alt=""
            width={pieceSize}
            height={pieceSize}
            draggable={false}
            style={{
              left: `${(sliderPosition / sliderWidth) * 100}%`,
              top: `${(pieceTop / sliderHeight) * 100}%`,
              width: `${(pieceSize / sliderWidth) * 100}%`,
              height: `${(pieceSize / sliderHeight) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <div className="loginCaptchaSliderControl">
        <span className="loginCaptchaSliderHint" aria-hidden="true">
          按住滑块，拖动完成拼图
        </span>
        <span className="loginCaptchaSliderProgress" style={{ width: `${progress}%` }} aria-hidden="true" />
        <span
          className="loginCaptchaSliderHandle"
          style={{ left: `${progress}%`, transform: `translateX(-${progress}%)` }}
          aria-hidden="true"
        >
          <ChevronsRight size={19} />
        </span>
        <input
          className="loginCaptchaRange"
          name="captchaAnswer"
          type="range"
          min="0"
          max={maxPosition}
          step="1"
          value={sliderPosition}
          onChange={(event) => setSliderPosition(Number(event.target.value))}
          aria-label="拖动滑块对齐拼图缺口"
          aria-valuetext={`已拖动 ${Math.round(progress)}%`}
        />
      </div>
    </div>
  );
}
