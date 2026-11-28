import { httpClient } from "@/services/http-client";

// Mirrors the backend's trimmed DashboardResponse (app/schemas/progress.py) —
// "Chủ đề"/Progress/Weakness were removed, so recent_weaknesses/subjects_progress
// no longer exist here. Canonical definition - use-dashboard.ts re-exports it.
/** One quiz submission (backend ResultRow, app/schemas/progress.py). */
export interface ResultRow {
  // QuizResult.id (one past submission) - matches a local QuizAttempt's
  // backendResultId once synced (see quiz-store.ts::mergeFromServer).
  id: string;
  // Quiz.id - matches a local Quiz.backendId once synced.
  quiz_id: string;
  title: string | null;
  subject_id?: string | null;
  score: number;
  correct_count?: number;
  total_questions?: number;
  /** Only part of the quiz was answered: a review of due questions or a retry of the wrong ones. */
  partial?: boolean;
  created_at: string;
}

export interface DashboardData {
  total_subjects: number;
  total_quizzes: number;
  total_questions_answered: number;
  avg_score: number;
  /** The 5 quizzes worked on most recently, each with its latest submission. */
  recent_quizzes: ResultRow[];
}

// =============================================================================
// Shared, in-memory cache for dashboard data - same reasoning as
// features/reviews/services/review-store.ts: DashboardPage unmounts and
// remounts every time the user navigates away and back (see
// learning-workspace.tsx's `workspace.activePage === "dashboard" ? <DashboardPage/> : null`),
// which used to refetch from scratch (and show a loading state) on every
// single visit, not just the first.
//
// Stale-while-revalidate: `ensureLoaded()` shows the cached snapshot
// instantly on a revisit (no loading flicker), but still kicks a silent
// background refetch every time, so numbers that changed elsewhere (a quiz
// just submitted, a document just uploaded) catch up shortly after instead
// of staying stuck at whatever they were on first load this session.
// `refresh()` is the same fetch, exposed for an explicit caller (the page's
// own "Thử lại" button on error).
//
// NOT per-account scoped on its own - logout/login is a client-side route
// change, not a full reload, so this module instance survives an account
// switch unless reset() is called.
// =============================================================================

type Snapshot = { data: DashboardData | null; loaded: boolean; error: string | null };

const INITIAL: Snapshot = { data: null, loaded: false, error: null };

function createDashboardStore() {
  let state: Snapshot = INITIAL;
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;

  function publish(next: Snapshot) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function fetchAndPublish(): Promise<void> {
    try {
      const data = await httpClient.get<DashboardData>("/progress/dashboard");
      publish({ data, loaded: true, error: null });
    } catch (err) {
      // Keep the last successful `data` on a transient error (e.g. the page
      // can still render with the previous numbers instead of going blank).
      publish({
        data: state.data,
        loaded: true,
        error: err instanceof Error ? err.message : "Không thể tải dữ liệu dashboard. Vui lòng thử lại.",
      });
    }
  }

  function triggerFetch(): Promise<void> {
    if (!inFlight) {
      inFlight = fetchAndPublish().finally(() => { inFlight = null; });
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
     * instantly (cached snapshot, no loading flicker) and revalidates
     * silently in the background. */
    ensureLoaded(): Promise<void> {
      const pending = triggerFetch();
      return state.loaded ? Promise.resolve() : pending;
    },
    /** Force a real re-fetch (manual "Thử lại", or any other explicit
     * refresh) and push the result to every subscriber. */
    refresh(): Promise<void> {
      return triggerFetch();
    },
    /** Clear back to "nothing loaded yet" - call this on logout so the next
     * account's first load doesn't briefly show the previous account's
     * cached numbers (see the module-level note above). */
    reset(): void {
      inFlight = null;
      publish(INITIAL);
    },
  };
}

export const dashboardStore = createDashboardStore();
