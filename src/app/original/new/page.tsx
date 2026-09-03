import { OriginalDraftLauncher } from "@/features/original-editor/OriginalDraftLauncher";

export const dynamic = "force-dynamic";

export default function NewOriginalPage() {
  return <OriginalDraftLauncher mode="new" />;
}
