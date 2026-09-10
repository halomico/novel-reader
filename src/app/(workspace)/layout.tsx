import "../styles/common.css";
import "../workspace.css";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

/**
 * The authenticated workspace chrome lives above its pages so client route
 * transitions replace only the content slot. Guests still pass through for
 * the public settings page; protected pages perform their own redirect.
 */
export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return user ? <UserWorkspace user={user}>{children}</UserWorkspace> : children;
}
