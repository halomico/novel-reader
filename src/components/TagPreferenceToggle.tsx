"use client";

import { useState, useTransition } from "react";
import { updateTagPreferenceInlineAction } from "@/app/tags/actions";

export function TagPreferenceToggle({
  tagId,
  initialVisible,
  showLabel,
  hideLabel,
}: {
  tagId: number;
  initialVisible: boolean;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(initialVisible);
  const [pending, startTransition] = useTransition();
  const label = visible ? hideLabel : showLabel;

  function toggle() {
    if (pending) return;
    const nextVisible = !visible;
    setVisible(nextVisible);
    startTransition(async () => {
      try {
        const saved = await updateTagPreferenceInlineAction(tagId, !nextVisible);
        if (!saved) setVisible(!nextVisible);
      } catch {
        setVisible(!nextVisible);
      }
    });
  }

  return (
    <button
      className="tagVisibilityControl"
      type="button"
      role="switch"
      aria-checked={visible}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={toggle}
    >
      <span className="tagVisibilitySlider" aria-hidden="true"><span /></span>
    </button>
  );
}
