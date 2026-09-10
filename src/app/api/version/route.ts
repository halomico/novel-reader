import { NextResponse } from "next/server";
import { getPostgresSchemaStatus } from "@/core/db/postgres-migrations";
import { createVersionResponse } from "./response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return createVersionResponse(getPostgresSchemaStatus);
}
