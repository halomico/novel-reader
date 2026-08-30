import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { AdminStationConversation } from "@/components/AdminStationWorkspace";
import { getStationDisplayName } from "@/lib/config";
import { getStationThread, listStationMessages, markStationThreadRead } from "@/lib/station";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminStationThreadPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminStationThreadPage({ params }: AdminStationThreadPageProps) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const thread = getStationThread(id, { admin: true });
  if (!thread) notFound();
  const messages = listStationMessages(thread.id);
  markStationThreadRead(thread.id, "admin");

  return (
    <AdminFrame
      active="station"
      breadcrumbs={[{ label: "站务消息", href: "/admin/station" }, { label: thread.subject }]}
      mobileImmersive
    >
      <div className="adminWorkspace adminStationDetail">
        <AdminStationNavigation active="inbox" />
        <section className="adminStationConversationPage">
          <AdminStationConversation
            thread={thread}
            messages={messages}
            stationDisplayName={getStationDisplayName()}
            backHref="/admin/station"
          />
        </section>
      </div>
    </AdminFrame>
  );
}
