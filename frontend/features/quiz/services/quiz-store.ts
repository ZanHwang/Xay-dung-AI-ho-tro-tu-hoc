import { z } from "zod";
import type { Quiz, QuizAttempt, QuizDraft, QuizResultResponse } from "../types";

export const QUIZ_STORAGE_KEY = "jarvis.quizzes.v1";
const questionSchema = z.object({
  id: z.string().min(1), topic: z.string().min(1), difficulty: z.enum(["easy", "medium", "hard"]),
  prompt: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(6),
  correctIndex: z.number().int().nonnegative(), explanation: z.string().min(1),
  backendTopic: z.string().nullable().optional(),
  backendLastCorrect: z.boolean().nullable().optional(),
}).refine((question) => question.correctIndex < question.options.length);
const quizSchema = z.object({
  id: z.string().min(1), subjectId: z.string(), title: z.string().min(1), createdAt: z.string().datetime(),
  adaptive: z.boolean().optional(), difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  backendId: z.string().optional(),
  submitQuizId: z.string().optional(),
  documentId: z.string().nullable().optional(),
  source: z.enum(["sample", "api", "shared", "weakness", "wrong", "review"]), conversationId: z.string().nullable(),
  questions: z.array(questionSchema).min(1).max(50).refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length),
});
const draftSchema = z.object({ id: z.string().min(1), quizId: z.string().min(1), startedAt: z.string().datetime(), answers: z.record(z.number().int().nonnegative()) });
const attemptSchema = draftSchema.extend({
  submittedAt: z.string().datetime(), backendResultId: z.string().optional(),
  questionIds: z.array(z.string()).optional(),
});
const savedSchema = z.object({
  quizzes: z.array(quizSchema), drafts: z.array(draftSchema), attempts: z.array(attemptSchema),
}).refine((data) => {
  const quizzes = new Map(data.quizzes.map((quiz) => [quiz.id, quiz]));
  const runs = [...data.drafts, ...data.attempts];
  return quizzes.size === data.quizzes.length && new Set(runs.map((run) => run.id)).size === runs.length &&
    new Set(data.drafts.map((draft) => draft.quizId)).size === data.drafts.length && runs.every((run) => {
      const quiz = quizzes.get(run.quizId);
      return quiz && Object.entries(run.answers).every(([id, answer]) => {
        const question = quiz.questions.find((item) => item.id === id);
        return question && answer < question.options.length;
      });
    });
});
type Snapshot = { quizzes: Quiz[]; drafts: QuizDraft[]; attempts: QuizAttempt[]; ready: boolean; error: string | null };

// Scoped by account (userId) since v2 — before that, every account on the
// same browser shared one unscoped key, leaking quiz history between them.
// `userId` is optional only so existing tests (which don't care about
// per-account scoping) keep working against the bare key.
type StorageAccess = Pick<Storage, "getItem" | "setItem"> & { removeItem?: Storage["removeItem"] };

export function createQuizStore(storage: () => StorageAccess, userId?: string) {
  const key = userId ? `${QUIZ_STORAGE_KEY}:${userId}` : QUIZ_STORAGE_KEY;
  let state: Snapshot = { quizzes: [], drafts: [], attempts: [], ready: false, error: null };
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) { state = next; listeners.forEach((listener) => listener()); }
  function commit(next: Snapshot) {
    try {
      storage().setItem(key, JSON.stringify({ quizzes: next.quizzes, drafts: next.drafts, attempts: next.attempts }));
      publish({ ...next, error: null });
    } catch { publish({ ...next, error: "Không thể lưu Quiz trên trình duyệt. Dữ liệu hiện chỉ được giữ trong phiên này." }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate() {
      if (state.ready) return;
      try {
        const ownValue = storage().getItem(key);
        // One-time migration: claim data saved under the old unscoped key
        // before this account has any of its own, so the first login after
        // this change doesn't lose existing quiz history — then remove the
        // old key right away so a DIFFERENT account can't also claim it.
        let value = ownValue;
        let migratedFrom: string | null = null;
        if (value === null && userId) {
          migratedFrom = storage().getItem(QUIZ_STORAGE_KEY);
          value = migratedFrom;
        }
        const data = value === null ? { quizzes: [], drafts: [], attempts: [] } : savedSchema.parse(JSON.parse(value));
        if (migratedFrom !== null) {
          storage().setItem(key, migratedFrom);
          storage().removeItem?.(QUIZ_STORAGE_KEY);
        }
        publish({ ...data, ready: true, error: null });
      } catch { publish({ ...state, ready: true, error: "Không thể đọc dữ liệu Quiz. Dữ liệu lưu có thể bị lỗi hoặc trình duyệt chặn lưu trữ." }); }
    },
    create(input: Omit<Quiz, "id" | "createdAt">) {
      if (!state.ready) throw new Error("Đang tải dữ liệu Quiz.");
      const quiz = quizSchema.parse({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      commit({ ...state, quizzes: [quiz, ...state.quizzes] });
      return quiz.id;
    },
    start(quizId: string) {
      if (!state.ready || !state.quizzes.some((quiz) => quiz.id === quizId)) return null;
      const existing = state.drafts.find((draft) => draft.quizId === quizId);
      if (existing) return existing.id;
      const draft: QuizDraft = { id: crypto.randomUUID(), quizId, startedAt: new Date().toISOString(), answers: {} };
      commit({ ...state, drafts: [...state.drafts, draft] });
      return draft.id;
    },
    answer(draftId: string, questionId: string, answer: number) {
      const draft = state.drafts.find((item) => item.id === draftId);
      const question = state.quizzes.find((quiz) => quiz.id === draft?.quizId)?.questions.find((q) => q.id === questionId);
      if (!draft || !question || !Number.isInteger(answer) || answer < 0 || answer >= question.options.length) return;
      commit({ ...state, drafts: state.drafts.map((item) => item.id === draftId ? { ...item, answers: { ...item.answers, [questionId]: answer } } : item) });
    },
    submit(draftId: string, backendResultId?: string) {
      const draft = state.drafts.find((item) => item.id === draftId);
      if (!draft) return state.attempts.find((item) => item.id === draftId)?.id ?? null;
      const attempt: QuizAttempt = { ...draft, submittedAt: new Date().toISOString() };
      if (backendResultId) attempt.backendResultId = backendResultId;
      commit({ ...state, drafts: state.drafts.filter((item) => item.id !== draftId), attempts: [...state.attempts, attempt] });
      return attempt.id;
    },
    rename(quizId: string, title: string) {
      const trimmed = title.trim();
      if (!trimmed || !state.quizzes.some((quiz) => quiz.id === quizId)) return;
      commit({ ...state, quizzes: state.quizzes.map((quiz) => quiz.id === quizId ? { ...quiz, title: trimmed } : quiz) });
    },
    remove(quizId: string) {
      if (!state.quizzes.some((quiz) => quiz.id === quizId)) return;
      commit({
        ...state,
        quizzes: state.quizzes.filter((quiz) => quiz.id !== quizId),
        drafts: state.drafts.filter((draft) => draft.quizId !== quizId),
        attempts: state.attempts.filter((attempt) => attempt.quizId !== quizId),
      });
    },
    /**
     * Pull in quizzes/attempts that exist on the backend but not yet in this
     * browser's local store (e.g. a different device/browser for the same
     * account) — so quiz history looks the same everywhere, not just on the
     * device that created it. Matches by `backendId`/`backendResultId`
     * (never by `id`, which is a fresh random UUID assigned per device) so
     * repeat syncs never duplicate. Only adds quizzes that came with their
     * questions (`listFull`, not the lightweight `list`) — a quiz with no
     * questions can't be opened or retaken, so it's skipped rather than
     * added as a useless stub.
     */
    mergeFromServer(apiQuizzes: Quiz[], apiResults: QuizResultResponse[]) {
      if (!state.ready) return;
      // Postgres timestamps have no "Z"/offset suffix; Zod's .datetime()
      // requires one.
      const toIsoZ = (value: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);

      const knownBackendIds = new Set(state.quizzes.map((quiz) => quiz.backendId).filter(Boolean));
      const newQuizzes: Quiz[] = [];
      for (const apiQuiz of apiQuizzes) {
        if (!apiQuiz.backendId || knownBackendIds.has(apiQuiz.backendId) || !apiQuiz.questions.length) continue;
        try {
          const quiz = quizSchema.parse({ ...apiQuiz, id: crypto.randomUUID(), createdAt: toIsoZ(apiQuiz.createdAt) });
          newQuizzes.push(quiz);
          knownBackendIds.add(apiQuiz.backendId);
        } catch { /* skip malformed */ }
      }

      const allQuizzes = [...state.quizzes, ...newQuizzes];
      const byBackendId = new Map(allQuizzes.filter((quiz) => quiz.backendId).map((quiz) => [quiz.backendId as string, quiz]));
      // Match by local id AND backendResultId - a locally-created attempt
      // keeps its own local id even after the server confirms it under a
      // different (server-assigned) result id; matching by id alone let a
      // synced result re-add as a second, duplicate history entry.
      const existingAttemptIds = new Set(
        state.attempts.flatMap((attempt) => (attempt.backendResultId ? [attempt.id, attempt.backendResultId] : [attempt.id]))
      );
      const newAttempts: QuizAttempt[] = [];
      for (const result of apiResults) {
        if (existingAttemptIds.has(result.id)) continue;
        const quiz = byBackendId.get(result.quiz_id);
        if (!quiz) continue; // this quiz wasn't in the synced page — skip rather than guess
        const answers: Record<string, number> = {};
        for (const item of result.answers) {
          const question = quiz.questions.find((q) => q.id === item.question_id);
          if (question && typeof item.selected_answer === "number" && item.selected_answer < question.options.length) {
            answers[item.question_id] = item.selected_answer;
          }
        }
        try {
          const attempt = attemptSchema.parse({
            id: result.id, quizId: quiz.id, startedAt: toIsoZ(result.created_at),
            answers, submittedAt: toIsoZ(result.created_at), backendResultId: result.id,
            // The exact scope of this result (every question it covered,
            // skipped ones included) - not just `answers`' keys, which only
            // has the ones with a real selected option. Needed so a synced
            // review/retry-wrong submission (covering only part of this
            // quiz's own questions) doesn't get its quiz's OTHER questions
            // wrongly graded as unanswered (see quiz-engine.ts::gradeQuiz).
            questionIds: result.answers.map((item) => item.question_id),
          });
          newAttempts.push(attempt);
          existingAttemptIds.add(result.id);
        } catch { /* skip malformed */ }
      }

      if (!newQuizzes.length && !newAttempts.length) return;
      commit({ ...state, quizzes: [...newQuizzes, ...state.quizzes], attempts: [...state.attempts, ...newAttempts] });
    },
  };
}
