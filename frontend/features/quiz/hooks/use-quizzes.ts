"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createQuizStore } from "../services/quiz-store";
import { calculateMastery } from "../services/quiz-engine";
import { quizApi } from "../services/quiz-api";

/**
 * @param userId Scopes the localStorage key so quiz history doesn't leak
 * between accounts sharing the same browser (see createQuizStore).
 */
export function useQuizzes(userId: string) {
  const store = useMemo(() => createQuizStore(() => window.localStorage, userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Check if we should use API mode
  const isDemoMode = typeof window !== "undefined" &&
    !process.env.NEXT_PUBLIC_API_BASE_URL &&
    !sessionStorage.getItem("jarvis.auth.token");

  useEffect(() => {
    store.hydrate();
  }, [store]);

  // Load quizzes from API if in API mode
  useEffect(() => {
    if (!isDemoMode) {
      loadQuizzes();
    }
  }, [isDemoMode]);

  async function loadQuizzes() {
    try {
      const [quizzesResult, resultsResult] = await Promise.all([
        quizApi.listFull(),
        quizApi.getResults(),
      ]);
      store.mergeFromServer(quizzesResult.quizzes, resultsResult.results);
    } catch (err) {
      console.error("Failed to load quizzes:", err);
    }
  }

  const mastery = useMemo(() => calculateMastery(state.quizzes, state.attempts), [state.quizzes, state.attempts]);

  return { ...state, store, mastery, isDemoMode };
}

export type QuizController = ReturnType<typeof useQuizzes>;
