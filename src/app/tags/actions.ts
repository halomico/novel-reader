"use server";

import { revalidatePath } from "next/cache";
import { replacePostgresUserHiddenTags } from "@/domains/catalog/postgres-tags";
import { getCurrentUser } from "@/lib/user-auth";

export async function replaceTagPreferencesAction(tagIds: number[]): Promise<{ ok: boolean; hiddenIds: number[] }> {
  const user = await getCurrentUser();
  if (!user || !Array.isArray(tagIds)) return { ok: false, hiddenIds: [] };
  const hiddenIds = await replacePostgresUserHiddenTags(user.id, tagIds);
  revalidatePath("/tags");
  return { ok: true, hiddenIds };
}
