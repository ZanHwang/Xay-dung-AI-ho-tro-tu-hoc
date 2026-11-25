"use client";

import { useEffect } from "react";
import { X, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Quiz } from "../types";
import type { QuizController } from "../hooks/use-quizzes";
import { QuizRunner } from "./quiz-runner";

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
  // Escape closes the overlay (same convention as ReadingView).
  useEffect(() => {
    if (!quiz) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quiz, onClose]);

  if (!quiz) return null;

  return (
    <div className="fixed inset-0 z-50 flex h-full w-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
          <ClipboardList className="size-4" />
        </span>
        <p className="truncate text-sm font-medium">{quiz.title}</p>
        <Button variant="outline" size="icon" className="ml-auto size-8" onClick={onClose} aria-label="Đóng (Esc)">
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 24 }}>
        <QuizRunner quiz={quiz} quizzes={quizzes} initialAttemptId={initialAttemptId} onSwitchQuiz={onSwitchQuiz} autoStart={autoStart} />
      </div>
    </div>
  );
}
