"use client";

import { Upload } from "lucide-react";
import { useFormStatus } from "react-dom";
import { uploadAvatarAction } from "@/app/account/actions";

function AvatarPicker({ maxAvatarMb }: { maxAvatarMb: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="avatarPicker">
      <label className={pending ? "accountActionButton isPending" : "accountActionButton"} title={`支持 PNG、JPG、WebP、GIF，最大 ${maxAvatarMb} MB`}>
        <Upload size={15} aria-hidden="true" />
        <span>{pending ? "上传中" : "上传头像"}</span>
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

export function AvatarUploadForm({ maxAvatarMb }: { maxAvatarMb: string }) {
  return (
    <form className="avatarUploadForm" action={uploadAvatarAction}>
      <AvatarPicker maxAvatarMb={maxAvatarMb} />
    </form>
  );
}
