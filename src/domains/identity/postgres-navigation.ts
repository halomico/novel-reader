import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export type PostgresUserNavigationState = Readonly<{
  unreadMessages: number;
  marketAccess: boolean;
}>;

type NavigationRow = QueryResultRow & {
  unread_messages: string | number;
  market_access: boolean;
};

function positiveUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid PostgreSQL navigation user id");
  return value;
}

function trustLevel(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new Error("Invalid PostgreSQL navigation trust level");
  return value;
}

/** Header-only projection: unread state and navigation permission in one query. */
export async function readPostgresUserNavigationState(
  executor: SqlExecutor,
  user: { id: number; role: "user" | "admin"; trustLevel: number },
): Promise<PostgresUserNavigationState> {
  const result = await executor.query<NavigationRow>({
    name: "identity-user-navigation-state-v1",
    text: `SELECT
             (
               SELECT COUNT(*)
               FROM announcements announcement
               WHERE announcement.status = 'published'
                 AND announcement.display_mode IN ('list', 'both')
                 AND announcement.published_at IS NOT NULL
                 AND announcement.published_at <= clock_timestamp()
                 AND (announcement.expires_at IS NULL OR announcement.expires_at > clock_timestamp())
                 AND NOT EXISTS (
                   SELECT 1 FROM announcement_reads reading
                   WHERE reading.announcement_id = announcement.id AND reading.user_id = $1
                 )
             ) + (
               SELECT COUNT(*)
               FROM station_threads thread
               WHERE thread.user_id = $1
                 AND EXISTS (
                   SELECT 1 FROM station_messages message
                   WHERE message.thread_id = thread.id
                     AND message.author_role = 'admin'
                     AND message.id > thread.user_last_read_message_id
                 )
             ) AS unread_messages,
             ($3 = 'admin' OR EXISTS (
               SELECT 1 FROM user_levels level
               WHERE level.level = $2 AND level.permissions ? 'market_access'
             )) AS market_access`,
    values: [positiveUserId(user.id), trustLevel(user.trustLevel), user.role],
  });
  const row = result.rows[0];
  const unreadMessages = typeof row?.unread_messages === "number"
    ? row.unread_messages
    : Number(row?.unread_messages ?? 0);
  if (!Number.isSafeInteger(unreadMessages) || unreadMessages < 0 || typeof row?.market_access !== "boolean") {
    throw new Error("Invalid PostgreSQL navigation state");
  }
  return Object.freeze({ unreadMessages, marketAccess: row.market_access });
}
