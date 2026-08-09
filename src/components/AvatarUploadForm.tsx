"use client";

import { Upload } from "lucide-react";
import { useFormStatus } from "react-dom";
import { uploadAvatarAction } from "@/app/account/actions";
import { DEFAULT_LOCALE, uiText, type AppLocale } from "@/lib/locale";

function AvatarPicker({ maxAvatarMb, locale }: { maxAvatarMb: string; locale: AppLocale }) {
  const { pending } = useFormStatus();
  return (
    <div className="avatarPicker">
      <label
        className={pending ? "accountActionButton isPending" : "accountActionButton"}
        title={`${locale === "zh-Hant" ? "支援" : "支持"} PNG、JPG、WebP、GIF，${locale === "zh-Hant" ? "最大" : "最大"} ${maxAvatarMb} MB`}
      >
        <Upload size={15} aria-hidden="true" />
        <span>{uiText(locale, pending ? "上传中" : "上传头像")}</span>
        <input
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/pjpeg,image/webp,image/gif,.jpg,.jpeg,.jpe,.png,.webp,.gif"
          disabled={pending}
          onChange={(event) => {
            if (event.currentTarget.files?.length) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          required
        />
      </label>
    </div>
  );
}

export function AvatarUploadForm({
  maxAvatarMb,
  locale = DEFAULT_LOCALE,
}: {
  maxAvatarMb: string;
  locale?: AppLocale;
}) {
  return (
    <form className="avatarUploadForm" action={uploadAvatarAction}>
      <AvatarPicker maxAvatarMb={maxAvatarMb} locale={locale} />
    </form>
  );
}
