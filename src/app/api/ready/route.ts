import { getPostgresSchemaStatus } from "@/core/db/postgres-migrations";
import { createReadinessResponse } from "./response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return createReadinessResponse(request, { getSchemaStatus: getPostgresSchemaStatus });
}
