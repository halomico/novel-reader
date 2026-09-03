import { notFound, redirect } from "next/navigation";
import { OriginalComposerShell } from "@/features/original-editor/OriginalComposerShell";
import { getOriginalDraftForAuthor, listOriginalEditorTags } from "@/features/original-editor/server";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export default async function OriginalWritePage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const user = await getCurrentUser();
  const draftId = Number((await params).draftId);
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/original/write/${draftId}`)}`);
  if (!Number.isSafeInteger(draftId) || draftId <= 0) notFound();
  const draft = getOriginalDraftForAuthor(draftId, user.id);
  if (!draft) notFound();
  return <OriginalComposerShell initialDraft={draft} tags={listOriginalEditorTags()} />;
}
