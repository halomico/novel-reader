"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setUserTagHidden } from "@/lib/tag-preferences";
import { getCurrentUser } from "@/lib/user-auth";

function safeReturnPath(value: FormDataEntryValue | null): string {
  const path = String(value || "/tags");
  return path.startsWith("/tags") && !path.startsWith("//") && !/[\r\n#\\]/.test(path) ? path : "/tags";
}

export async function setTagPreferenceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tagId = Number(formData.get("tagId"));
  const returnPath = safeReturnPath(formData.get("returnPath"));
  if (Number.isInteger(tagId) && tagId > 0) {
    setUserTagHidden(user.id, tagId, formData.get("hidden") === "1");
  }
  revalidatePath("/tags");
  revalidatePath(returnPath.split("?", 1)[0]);
  redirect(returnPath);
}

export async function updateTagPreferenceInlineAction(tagId: number, hidden: boolean): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || !Number.isInteger(tagId) || tagId <= 0) return false;
  setUserTagHidden(user.id, tagId, hidden);
  return true;
}
