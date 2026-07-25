import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LegacyReportsPageProps = {
  searchParams: Promise<{
    status?: string;
    page?: string;
  }>;
};

export default async function LegacyReportsPage({ searchParams }: LegacyReportsPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: "reports" });
  if (params.status) next.set("status", params.status);
  if (params.page) next.set("page", params.page);
  redirect(`/admin/station?${next.toString()}`);
}
