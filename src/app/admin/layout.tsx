import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { NO_INDEX_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: NO_INDEX_ROBOTS };

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = getAdminAccessState(await headers());
  if (!access.allowed) {
    notFound();
  }

  return children;
}
