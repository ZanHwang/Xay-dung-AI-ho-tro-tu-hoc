import { reviewApi, type ReviewDueQuestion } from "./review-api";

// =============================================================================
// Shared, in-memory cache for "câu đến hạn ôn" (split out of the removed
// gamification-store.ts, which used to fetch this alongside XP/hearts).
//
// Stale-while-revalidate: `ensureLoaded()` returns immediately once loaded
// (no loading flicker on remount) but still kicks a silent background
// refetch every time, so a stale count (e.g. after answering a review quiz
// elsewhere) catches up shortly after without the caller waiting on it.
//
// NOT per-account scoped on its own - logout/login is a client-side route
// change (see user-workspace.tsx's `router.replace("/")`, not a full page
// reload), so this module instance survives an account switch. Callers MUST
// call reset() on logout.
// =============================================================================

type Snapshot = { due: ReviewDueQuestion[]; loaded: boolean };
const INITIAL: Snapshot = { due: [], loaded: false };

// Fetched once, generously sized - every consumer (header wants the full
// count, dashboard wants a short preview) slices this same list to the
// length it needs instead of each requesting its own limit from the API.
const DUE_FETCH_LIMIT = 50;

function createReviewStore() {
  let state: Snapshot = INITIAL;
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;

  function publish(next: Snapshot) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function fetchNow(): Promise<void> {
    const result = await reviewApi.dueReviews(DUE_FETCH_LIMIT);
    publish({ due: result.questions, loaded: true });
  }

  function triggerFetch(): Promise<void> {
    if (!inFlight) {
      inFlight = fetchNow()
        .catch(() => { /* keep last known snapshot; a later call can retry */ })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Not loaded yet: caller awaits the real fetch. Already loaded: returns
     * instantly and revalidates silently in the background. */
    ensureLoaded(): Promise<void> {
      const pending = triggerFetch();
      return state.loaded ? Promise.resolve() : pending;
    },
    /** Force a real re-fetch and push the result to every subscriber. */
    refresh(): Promise<void> {
      return triggerFetch();
    },
    /** Clear back to "nothing loaded yet" - call this on logout so the next
     * account's first load doesn't briefly show the previous account's due
     * reviews. */
    reset(): void {
      inFlight = null;
      publish(INITIAL);
    },
  };
}

export const reviewStore = createReviewStore();
