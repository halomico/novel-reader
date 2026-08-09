"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { createRegistrationInvites } from "@/lib/registration-invites";

export async function createRegistrationInvitesAction(input: {
  label: string;
  count: number;
  maxUses: number;
  expiresAt: string;
}): Promise<{ ok: true; codes: string[] } | { ok: false; message: string }> {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed || !(await getAdminSession())) {
    redirect("/admin/login");
  }
  try {
    return {
      ok: true,
      codes: createRegistrationInvites({
        ...input,
        expiresAt: input.expiresAt || null,
      }),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "邀请码生成失败" };
  }
}
