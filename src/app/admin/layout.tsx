import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = getAdminAccessState(await headers());
  if (!access.allowed) {
    notFound();
  }

  return children;
}
