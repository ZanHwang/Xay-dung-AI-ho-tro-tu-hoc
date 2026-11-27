"use client";

import { useState } from "react";
import type { Quiz } from "../types";
import type { QuizController } from "./use-quizzes";
import { quizApi } from "../services/quiz-api";
import { reviewStore } from "@/features/reviews/services/review-store";

/**
 * One quiz-viewing popup (QuizOverlay), shared app-wide - lifted out of
 * quiz-page.tsx (deleted; "quiz" was never a top-level page, see
 * config/navigation.ts) so "Quiz gần đây" (Dashboard) and "Ôn câu đến hạn"
 * (header bell + Dashboard) open the SAME full-screen popup already used by
 * a subject's own "Quiz" tab (SubjectQuizSummary), instead of navigating
 * anywhere.
 */
export function useQuizOverlay(quizzes: QuizController) {
  const [viewing, setViewing] = useState<Quiz | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  // Forces QuizOverlay to remount on every open (same reasoning as
  // SubjectQuizSummary's viewToken) - guarantees fresh internal state even
  // when re-opening the same quiz.
  const [token, setToken] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [dueDialogOpen, setDueDialogOpen] = useState(false);

  function open(quiz: Quiz, opts?: { attemptId?: string; autoStart?: boolean }) {
    setViewing(quiz);
    setAttemptId(opts?.attemptId ?? null);
    setAutoStart(opts?.autoStart ?? false);
    setToken((t) => t + 1);
  }

  function close() {
    setViewing(null);
  }

  // A retry ("Làm lại câu sai") inside QuizRunner created a different quiz -
  // re-point the overlay at it (same pattern as SubjectQuizSummary's
  // onSwitchQuiz).
  function switchTo(quizId: string) {
    const next = quizzes.store.getSnapshot().quizzes.find((q) => q.id === quizId);
    if (next) open(next, { autoStart: true });
  }

  /** Opens the due-review popup (lists quizzes with due questions - see
   * DueReviewDialog) - the entry point from both the header bell and the
   * Dashboard card's "Ôn ngay". Forces a fresh fetch every time it's opened
   * (not just once per page load) - the cached list (reviewStore) can go
   * stale after things like renaming a quiz or finishing a review elsewhere
   * in this same session, and nothing else re-triggers a refetch. */
  function openDueDialog() {
    setDueDialogOpen(true);
    void reviewStore.refresh();
  }

  function closeDueDialog() {
    setDueDialogOpen(false);
  }

  /** Picked one quiz from the due-review popup: pull just THAT quiz's own
   * due questions (read-only - no quiz is created, see quizApi.dueQuestions)
   * and open them straight into a fresh attempt, in a throwaway LOCAL-only
   * session (submitQuizId points back at the real quiz - see types.ts). */
  async function startReview(quizId: string) {
    setDueDialogOpen(false);
    setReviewLoading(true);
    setReviewError("");
    try {
      const quiz = await quizApi.dueQuestions(quizId);
      if (!quiz.questions.length) {
        setReviewError("Chưa có câu nào đến hạn ôn tập.");
        return;
      }
      const id = quizzes.store.create({
        subjectId: quiz.subjectId || "",
        title: `Ôn tập: ${quiz.title}`,
        difficulty: quiz.difficulty,
        source: "review",
        conversationId: null,
        questions: quiz.questions,
        backendId: undefined,
        submitQuizId: quiz.backendId,
      });
      // Read the store's live snapshot directly instead of `quizzes.quizzes`
      // (the hook's own snapshot from this render) - store.create() commits
      // synchronously, but this component won't re-render with the new list
      // until after this function returns.
      const created = quizzes.store.getSnapshot().quizzes.find((q) => q.id === id);
      if (created) open(created, { autoStart: true });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Không thể tạo Quiz ôn tập.");
    } finally {
      setReviewLoading(false);
    }
  }

  return {
    viewing, attemptId, autoStart, token, open, close, switchTo,
    dueDialogOpen, openDueDialog, closeDueDialog, startReview,
    reviewLoading, reviewError,
  };
}

export type QuizOverlayController = ReturnType<typeof useQuizOverlay>;
