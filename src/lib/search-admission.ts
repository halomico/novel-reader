/**
 * Bounds how many full-text searches one app instance runs at once. A search holds a
 * pooled PostgreSQL connection for up to its statement timeout, so an unbounded burst
 * of them would starve every other page of connections. Excess searches wait briefly
 * in arrival order and are refused once that wait expires, instead of piling onto
 * the pool. The limit is re-read on every acquisition, so an admin change applies to
 * the next search without a restart.
 */
type Waiter = { grant: (granted: boolean) => void; timer: ReturnType<typeof setTimeout> };
type AdmissionState = { active: number; limit: number; queue: Waiter[] };

export type SearchSlot = { release(): void };

const state = globalThis as typeof globalThis & { novelReaderSearchAdmission?: AdmissionState };

function admission(): AdmissionState {
  state.novelReaderSearchAdmission ||= { active: 0, limit: 1, queue: [] };
  return state.novelReaderSearchAdmission;
}

function drain(current: AdmissionState): void {
  while (current.queue.length && current.active < current.limit) {
    const next = current.queue.shift()!;
    clearTimeout(next.timer);
    current.active += 1;
    next.grant(true);
  }
}

function slot(current: AdmissionState): SearchSlot {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      current.active -= 1;
      drain(current);
    },
  };
}

export async function acquireSearchSlot(limit: number, maxWaitMs: number): Promise<SearchSlot | null> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Search concurrency limit must be a positive integer");
  const current = admission();
  current.limit = limit;
  // A raised limit must admit queued searches before a newcomer can jump the queue.
  drain(current);
  if (current.active < limit && current.queue.length === 0) {
    current.active += 1;
    return slot(current);
  }
  if (!(maxWaitMs > 0)) return null;
  const granted = await new Promise<boolean>((resolve) => {
    const waiter: Waiter = {
      grant: resolve,
      timer: setTimeout(() => {
        const index = current.queue.indexOf(waiter);
        if (index >= 0) current.queue.splice(index, 1);
        resolve(false);
      }, maxWaitMs),
    };
    current.queue.push(waiter);
  });
  return granted ? slot(current) : null;
}
