import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/locale-server";
import { withLocalePath } from "@/lib/locale";

export default async function FavoritesCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const target = new URLSearchParams({ view: "favorites" });
  if (params.page) target.set("page", params.page);
  if (params.type) target.set("type", params.type);
  redirect(withLocalePath(`/activity?${target.toString()}`, locale));
}
