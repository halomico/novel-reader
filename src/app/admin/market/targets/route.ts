import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { database } from "@/core/db/postgres";
import {
  getPostgresEntitlementTargetOption,
  listPostgresEntitlementTargets,
} from "@/domains/access/postgres-entitlements";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  ENTITLEMENT_TARGET_RIGHTS,
  isEntitlementTargetType,
} from "@/lib/entitlement-protocol";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed || !(await getAdminSession())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(request.url);
  const targetType = url.searchParams.get("type");
  if (!isEntitlementTargetType(targetType)) {
    return NextResponse.json({ ok: false, message: "资源类型无效" }, { status: 400 });
  }
  const targets = await listPostgresEntitlementTargets(database("web"), targetType, url.searchParams.get("q") || "", 30);
  const selectedId = url.searchParams.get("selected") || "";
  const selected = selectedId && !targets.some((target) => target.id === selectedId)
    ? await getPostgresEntitlementTargetOption(database("web"), targetType, selectedId)
    : null;
  return NextResponse.json({
    ok: true,
    targets: selected ? [selected, ...targets] : targets,
    rights: ENTITLEMENT_TARGET_RIGHTS[targetType],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
