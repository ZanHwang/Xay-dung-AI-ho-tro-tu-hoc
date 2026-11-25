"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ReviewDueQuestion } from "@/features/reviews/services/review-api";
import { reviewStore } from "@/features/reviews/services/review-store";

function isDemoMode(): boolean {
  if (typeof window === "undefined") return true;
  return !process.env.NEXT_PUBLIC_API_BASE_URL && !sessionStorage.getItem("jarvis.auth.token");
}

const DEMO_DUE: ReviewDueQuestion[] = [];

export function useDueReviews(limit = 5) {
  const isDemo = isDemoMode();
  const snapshot = useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot, reviewStore.getSnapshot);

  useEffect(() => {
    if (!isDemo) void reviewStore.ensureLoaded();
  }, [isDemo]);

  return { due: isDemo ? DEMO_DUE : snapshot.due.slice(0, limit), isDemo };
}
