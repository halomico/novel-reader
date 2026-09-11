import { cache } from "react";
import { database } from "@/core/db/postgres";
import {
  readPostgresUserNavigationState,
  type PostgresUserNavigationState,
} from "@/domains/identity/postgres-navigation";

type NavigationUser = { id: number; role: "user" | "admin"; trustLevel: number };

const readNavigationState = cache((userId: number, role: NavigationUser["role"], trustLevel: number) => (
  readPostgresUserNavigationState(database("web"), { id: userId, role, trustLevel })
));

/** The site header and the workspace chrome share one unread/market query per render. */
export function getUserNavigationState(user: NavigationUser): Promise<PostgresUserNavigationState> {
  return readNavigationState(user.id, user.role, user.trustLevel);
}
