"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { DueQuizSummary } from "@/features/reviews/services/review-api";
import { reviewStore } from "@/features/reviews/services/review-store";

function isDemoMode(): boolean {
  if (typeof window === "undefined") return true;
  return !process.env.NEXT_PUBLIC_API_BASE_URL && !sessionStorage.getItem("jarvis.auth.token");
}

const DEMO: { total: number; quizzes: DueQuizSummary[] } = { total: 0, quizzes: [] };

export function useDueReviews() {
  const isDemo = isDemoMode();
  const snapshot = useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot, reviewStore.getSnapshot);

  useEffect(() => {
    if (!isDemo) void reviewStore.ensureLoaded();
  }, [isDemo]);

  return isDemo
    ? { total: DEMO.total, quizzes: DEMO.quizzes, isDemo }
    : { total: snapshot.total, quizzes: snapshot.quizzes, isDemo };
}
