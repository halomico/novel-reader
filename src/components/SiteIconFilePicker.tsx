"use client";

import { ImagePlus } from "lucide-react";
import { useState } from "react";

export function SiteIconFilePicker() {
  const [fileName, setFileName] = useState("");

  return (
    <label className="siteIconFileField" title="支持 PNG、JPG、WebP、ICO，最大 15 MB">
      <ImagePlus size={15} aria-hidden="true" />
      <span>{fileName || "选择"}</span>
      <input
        name="siteIcon"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon"
        required
        aria-label="选择站点图标"
        onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
      />
    </label>
  );
}
