export type MutationTone = "success" | "warning" | "error";

export type MutationResult<T = undefined> = {
  ok: boolean;
  message: string;
  tone: MutationTone;
  data?: T;
};

export function mutationResult<T>(
  ok: boolean,
  message: string,
  tone: MutationTone,
  data?: T,
): MutationResult<T> {
  return { ok, message, tone, ...(data === undefined ? {} : { data }) };
}
