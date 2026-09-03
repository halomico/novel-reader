import { OriginalDraftLauncher } from "@/features/original-editor/OriginalDraftLauncher";

export const dynamic = "force-dynamic";

export default async function EditOriginalPage({ params }: { params: Promise<{ slug: string }> }) {
  return <OriginalDraftLauncher mode="edit" articleSlug={(await params).slug} />;
}
