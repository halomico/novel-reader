"use client";

import { Dices, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { selectDefaultAvatarAction, uploadAvatarAction } from "@/app/account/actions";
import {
  generatedAvatarPath,
  generatedAvatarSeed,
} from "@/lib/default-avatar-data";
import { DEFAULT_LOCALE, uiText, type AppLocale } from "@/lib/locale";
import { UserAvatar } from "./UserAvatar";

type AvatarChoice = "current" | "generated" | "upload";

function AvatarEditorActions({
  canSave,
  locale,
  maxAvatarMb,
  onRandomize,
  onUpload,
}: {
  canSave: boolean;
  locale: AppLocale;
  maxAvatarMb: string;
  onRandomize: () => void;
  onUpload: (file: File | null) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="avatarEditorActions">
      <button
        className="avatarRandomizeButton"
        type="button"
        disabled={pending}
        aria-label={uiText(locale, "换一个随机头像")}
        title={uiText(locale, "换一个随机头像")}
        onClick={onRandomize}
      >
        <Dices size={18} aria-hidden="true" />
        <span>{uiText(locale, "随机")}</span>
      </button>
      <label
        className={pending ? "avatarUploadButton isPending" : "avatarUploadButton"}
        title={`${locale === "zh-Hant" ? "支援" : "支持"} PNG、JPG、WebP、GIF，${locale === "zh-Hant" ? "最大" : "最大"} ${maxAvatarMb} MB`}
      >
        <Upload size={15} aria-hidden="true" />
        <span>{uiText(locale, "上传")}</span>
        <input
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/pjpeg,image/webp,image/gif,.jpg,.jpeg,.jpe,.png,.webp,.gif"
          disabled={pending}
          onChange={(event) => onUpload(event.currentTarget.files?.[0] || null)}
        />
      </label>
      <button className="accountActionButton avatarEditorSave" type="submit" disabled={pending || !canSave}>
        {uiText(locale, pending ? "保存中" : "保存")}
      </button>
    </div>
  );
}

function randomAvatarPath(): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  const seed = Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
  return generatedAvatarPath(seed);
}

function AvatarEditorForm({
  maxAvatarMb,
  currentAvatarPath,
  displayName,
  locale,
  userId,
}: {
  maxAvatarMb: string;
  currentAvatarPath: string | null;
  displayName: string;
  locale: AppLocale;
  userId: number;
}) {
  const initialSeed = generatedAvatarSeed(userId, currentAvatarPath);
  const [candidate, setCandidate] = useState(() => generatedAvatarPath(initialSeed));
  const [choice, setChoice] = useState<AvatarChoice>("current");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);

  function randomize() {
    setCandidate(randomAvatarPath());
    setChoice("generated");
  }

  function chooseUpload(file: File | null) {
    setUploadPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
    setChoice(file ? "upload" : "current");
  }

  const submitAction = choice === "upload" ? uploadAvatarAction : selectDefaultAvatarAction;
  return (
    <form className="avatarEditorForm" action={submitAction}>
      <input type="hidden" name="avatarPath" value={candidate} />
      <div className="avatarEditorPreview" aria-live="polite">
        {choice === "upload" && uploadPreview ? (
          <span className="userAvatar hasImage"><img src={uploadPreview} alt="" /></span>
        ) : (
          <UserAvatar
            userId={userId}
            displayName={displayName}
            avatarPath={choice === "generated" ? candidate : currentAvatarPath}
          />
        )}
      </div>
      <AvatarEditorActions
        canSave={choice !== "current"}
        locale={locale}
        maxAvatarMb={maxAvatarMb}
        onRandomize={randomize}
        onUpload={chooseUpload}
      />
    </form>
  );
}

export function AvatarUploadForm({
  maxAvatarMb,
  locale = DEFAULT_LOCALE,
  currentAvatarPath = null,
  displayName,
  levelName,
  trustLevel,
  username,
  userId,
}: {
  maxAvatarMb: string;
  locale?: AppLocale;
  currentAvatarPath?: string | null;
  displayName: string;
  levelName: string;
  trustLevel: number;
  username: string;
  userId: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const previousScrollbarGutter = document.documentElement.style.scrollbarGutter;
    const reservedScrollbarWidth = window.innerWidth - document.documentElement.getBoundingClientRect().width;
    document.documentElement.style.scrollbarGutter = "auto";
    document.body.style.overflow = "hidden";
    if (reservedScrollbarWidth > 0) document.body.style.paddingRight = `${reservedScrollbarWidth}px`;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.documentElement.style.scrollbarGutter = previousScrollbarGutter;
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <div className="accountAvatarEditorEntry">
        <UserAvatar className="accountAvatarImage" userId={userId} displayName={displayName} avatarPath={currentAvatarPath} />
        <div className="accountAvatarIdentity">
          <strong>{displayName}</strong>
          <small>@{username} · Lv.{trustLevel} · {levelName}</small>
        </div>
        <button className="accountActionButton accountAvatarEditButton" type="button" onClick={() => setOpen(true)}>
          {uiText(locale, "编辑头像")}
        </button>
      </div>
      {open ? (
        <div className="avatarEditorBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="avatarEditorDrawer" role="dialog" aria-modal="true" aria-label={uiText(locale, "设置头像")}>
            <header>
              <strong>{uiText(locale, "设置头像")}</strong>
              <button type="button" autoFocus onClick={() => setOpen(false)} aria-label={uiText(locale, "关闭")}><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="avatarEditorBody">
              <AvatarEditorForm
                maxAvatarMb={maxAvatarMb}
                currentAvatarPath={currentAvatarPath}
                displayName={displayName}
                locale={locale}
                userId={userId}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
