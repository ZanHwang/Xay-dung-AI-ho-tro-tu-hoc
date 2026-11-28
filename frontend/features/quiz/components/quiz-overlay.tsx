"use client";

import { X, ClipboardList } from "lucide-react";
import type { Quiz } from "../types";
import type { QuizController } from "../hooks/use-quizzes";
import { QuizRunner } from "./quiz-runner";
import { useModalLayer } from "@/hooks/use-modal-layer";

/**
 * Opens one quiz (view result / retake / browse past submissions) full
 * screen, without navigating away from whatever page opened it — used by
 * SubjectQuizSummary so "Lịch sử Quiz" stays on the subject's own page.
 * Same full-screen-overlay convention as ReadingView (features/reading).
 */
export function QuizOverlay({ quiz, quizzes, initialAttemptId, onClose, onSwitchQuiz, autoStart }: {
  quiz: Quiz | null;
  quizzes: QuizController;
  /** Which past submission to open to (typically the latest one) — leave
   * unset to show the "Bắt đầu làm bài" prompt instead. */
  initialAttemptId?: string | null;
  onClose: () => void;
  /** A retry ("Làm lại câu sai") created a different quiz — the caller owns
   * which quiz object this overlay is showing (SubjectQuizSummary's
   * `viewing` state), so it looks the new id up and re-points `quiz`. */
  onSwitchQuiz: (quizId: string) => void;
  /** Open straight into a fresh attempt (the "Làm lại" row button) instead
   * of showing the latest past attempt first. */
  autoStart?: boolean;
}) {
  const layerRef = useModalLayer(onClose);

  if (!quiz) return null;

  return (
    <div className="overlay" ref={layerRef} tabIndex={-1}>
      <div className="overlay-bar">
        <span className="file-ic" aria-hidden="true"><ClipboardList className="size-5" /></span>
        <div>
          <h2>{quiz.title}</h2>
        </div>
        <button type="button" className="more" onClick={onClose} aria-label="Đóng (Esc)">
          <X className="size-5" />
        </button>
      </div>
      <div className="overlay-body">
        <QuizRunner quiz={quiz} quizzes={quizzes} initialAttemptId={initialAttemptId} onSwitchQuiz={onSwitchQuiz} autoStart={autoStart} />
      </div>
    </div>
  );
}
