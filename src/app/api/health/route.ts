import { database } from "@/core/db/postgres";
import { createHealthResponse } from "./response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return createHealthResponse(database("web"));
}
