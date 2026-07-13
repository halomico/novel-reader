"use client";

import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import type { CaptchaPurpose, LoginCaptchaChallenge } from "@/lib/login-captcha";
import type { UserLoginCaptchaMode } from "@/lib/site-settings";
import { LoginCaptcha } from "./LoginCaptcha";

type AuthCaptchaFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  captchaMode: UserLoginCaptchaMode;
  purpose: CaptchaPurpose;
  children: ReactNode;
};

export function AuthCaptchaForm({ action, captchaMode, purpose, children }: AuthCaptchaFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const allowSubmitRef = useRef(false);
  const [challenge, setChallenge] = useState<LoginCaptchaChallenge | null>(null);
  const [answer, setAnswer] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isLoading) {
        setIsOpen(false);
        setChallenge(null);
        setAnswer("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isLoading, isOpen]);

  async function loadChallenge() {
    setIsLoading(true);
    setError("");
    setAnswer("");
    try {
      const response = await fetch("/api/login-captcha", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose }),
      });
      const data = (await response.json()) as { challenge?: LoginCaptchaChallenge; message?: string };
      if (!response.ok || !data.challenge) {
        throw new Error(data.message || "验证码加载失败");
      }
      setChallenge(data.challenge);
    } catch (loadError) {
      setChallenge(null);
      setError(loadError instanceof Error ? loadError.message : "验证码加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  function closeDialog() {
    if (isLoading) {
      return;
    }
    setIsOpen(false);
    setChallenge(null);
    setAnswer("");
    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (captchaMode === "off") {
      return;
    }
    if (allowSubmitRef.current) {
      allowSubmitRef.current = false;
      return;
    }

    event.preventDefault();
    if (!isOpen) {
      setIsOpen(true);
      void loadChallenge();
      return;
    }
    if (!challenge || isLoading) {
      return;
    }
    allowSubmitRef.current = true;
    formRef.current?.requestSubmit();
  }

  const answerReady = challenge?.mode === "image" ? answer.trim().length === 4 : Number(answer) > 0;
  const confirmLabel = purpose === "login" ? "验证并登录" : "验证并注册";

  return (
    <form ref={formRef} className="userPanel authPanel" action={action} onSubmit={submit}>
      {children}
      {isOpen ? (
        <div className="authCaptchaBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
          <section className="authCaptchaDialog" role="dialog" aria-modal="true" aria-labelledby="auth-captcha-title">
            <header className="authCaptchaDialogHeader">
              <span className="authCaptchaDialogIcon" aria-hidden="true">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2 id="auth-captcha-title">完成安全验证</h2>
                <p>验证通过后继续{purpose === "login" ? "登录" : "注册"}</p>
              </div>
              <button className="authCaptchaClose" type="button" onClick={closeDialog} disabled={isLoading} aria-label="关闭验证" title="关闭">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="authCaptchaBody">
              {isLoading ? (
                <div className="authCaptchaLoading" aria-live="polite">
                  <LoaderCircle size={22} className="isSpinning" aria-hidden="true" />
                  正在生成验证码
                </div>
              ) : challenge ? (
                <LoginCaptcha challenge={challenge} answer={answer} onAnswerChange={setAnswer} onRefresh={loadChallenge} />
              ) : (
                <div className="authCaptchaError" role="alert">
                  <p>{error || "验证码加载失败"}</p>
                  <button type="button" onClick={loadChallenge}>重试</button>
                </div>
              )}
            </div>

            {challenge ? (
              <footer className="authCaptchaFooter">
                <button type="button" className="authCaptchaSecondary" onClick={closeDialog}>取消</button>
                <button type="submit" disabled={!answerReady || isLoading}>{confirmLabel}</button>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}
    </form>
  );
}
