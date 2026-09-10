import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/locale-server";
import { withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function NovelChaptersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; resume?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const target = new URLSearchParams();
  if (query.from) target.set("from", query.from);
  if (query.resume) target.set("resume", query.resume);
  const suffix = target.size ? `?${target}` : "";
  redirect(withLocalePath(`/books/${encodeURIComponent(id)}${suffix}`, await getRequestLocale()));
}
