"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { database } from "@/core/db/postgres";
import { deletePostgresNovel, togglePostgresPinnedNovel } from "@/domains/reading/postgres-reader-catalog";
import { getCurrentUser } from "@/lib/user-auth";

async function requireReaderAdmin() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  return user;
}

function validBookId(formData: FormData): number | null {
  const bookId = Number(formData.get("bookId"));
  return Number.isInteger(bookId) && bookId > 0 ? bookId : null;
}

function safeReaderReturnPath(formData: FormData): string {
  const requested = String(formData.get("returnPath") || "");
  return requested.startsWith("/") &&
    !requested.startsWith("//") &&
    !/[\\\r\n#]/u.test(requested)
    ? requested
    : "/novels";
}

export async function toggleReaderPinnedNovelAction(formData: FormData) {
  await requireReaderAdmin();
  const bookId = validBookId(formData);
  if (!bookId) notFound();

  const result = await togglePostgresPinnedNovel(database("web"), bookId);
  if (!result.found) notFound();
  revalidatePath("/");
  revalidatePath("/novels");
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/admin/books");
}

export async function deleteReaderNovelAction(formData: FormData) {
  await requireReaderAdmin();
  const bookId = validBookId(formData);
  if (!bookId) notFound();

  const returnPath = safeReaderReturnPath(formData);
  if (!await deletePostgresNovel(database("web"), bookId)) notFound();
  revalidatePath("/");
  revalidatePath("/novels");
  revalidatePath(`/books/${bookId}`);
  revalidatePath(returnPath.split("?")[0]);
  revalidatePath("/admin/books");
  redirect(returnPath);
}
