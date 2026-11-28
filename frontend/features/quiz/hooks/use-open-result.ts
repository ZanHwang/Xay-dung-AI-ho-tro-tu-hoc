"use client";

import { useCallback, useState } from "react";
import { quizApi } from "../services/quiz-api";
import type { Quiz } from "../types";
import type { QuizController } from "./use-quizzes";

/**
 * Opens one past submission (backend quiz id + result id) in the quiz popup.
 * The browser only holds the most recent quizzes and submissions (see
 * use-quizzes.ts), so an older one is fetched from the server first and
 * added to the local store, then opened like any other.
 */
export function useOpenResult(
  quizzes: QuizController,
  onViewQuiz: (quiz: Quiz, opts?: { attemptId?: string }) => void,
) {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");

  const open = useCallback(async (quizId: string, resultId: string) => {
    const find = () => {
      const snapshot = quizzes.store.getSnapshot();
      return {
        quiz: snapshot.quizzes.find((item) => item.backendId === quizId),
        attempt: snapshot.attempts.find((item) => item.backendResultId === resultId),
      };
    };
    let found = find();
    setError("");
    if (!found.quiz || !found.attempt) {
      setOpening(resultId);
      try {
        const [quiz, results] = await Promise.all([
          found.quiz ? null : quizApi.get(quizId),
          quizApi.getResults(quizId, { limit: 100 }),
        ]);
        quizzes.store.mergeFromServer(quiz ? [quiz] : [], results.results);
        found = find();
      } catch {
        setError("Không mở được bài này. Thử lại sau.");
        return;
      } finally {
        setOpening(null);
      }
    }
    if (found.quiz) onViewQuiz(found.quiz, { attemptId: found.attempt?.id });
    else setError("Bài quiz này không còn nữa.");
  }, [quizzes.store, onViewQuiz]);

  return { open, opening, error };
}
