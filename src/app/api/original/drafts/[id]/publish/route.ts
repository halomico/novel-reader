import { createOriginalDraftPublishHandler } from "@/features/original-editor/publish-route";
import { publishOriginalDraft } from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createOriginalDraftPublishHandler({
  currentUser: getCurrentUserFromRequest,
  publish: publishOriginalDraft,
});
