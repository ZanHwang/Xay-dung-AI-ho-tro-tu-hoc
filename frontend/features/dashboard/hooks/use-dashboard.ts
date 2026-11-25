"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { dashboardStore, type DashboardData } from "@/features/dashboard/services/dashboard-store";

export type { DashboardData };

const DEMO_DASHBOARD: DashboardData = {
  total_subjects: 3,
  total_quizzes: 12,
  total_questions_answered: 120,
  avg_score: 72.5,
  recent_quizzes: [
    {
      id: "quiz-result-1",
      quiz_id: "quiz-1",
      title: "Kiểm tra Giải tích",
      score: 85,
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "quiz-result-2",
      quiz_id: "quiz-2",
      title: "Ôn tập Python",
      score: 90,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
  ],
};

// Check if we should use API or demo mode (matches use-learning-workspace pattern)
function isDemoMode(): boolean {
  if (typeof window === "undefined") return true;
  return !process.env.NEXT_PUBLIC_API_BASE_URL && !sessionStorage.getItem("jarvis.auth.token");
}

export function useDashboard() {
  const isDemo = isDemoMode();
  // Shared across every mount of this hook (see dashboard-store.ts) - a
  // revisit to the Dashboard page (which fully unmounts when you navigate
  // away) reads the already-loaded snapshot instantly instead of refetching
  // and flashing a loading state every single time.
  const snapshot = useSyncExternalStore(dashboardStore.subscribe, dashboardStore.getSnapshot, dashboardStore.getSnapshot);

  useEffect(() => {
    if (!isDemo) void dashboardStore.ensureLoaded();
  }, [isDemo]);

  const refresh = useCallback(async () => {
    if (!isDemo) await dashboardStore.refresh();
  }, [isDemo]);

  return {
    data: isDemo ? DEMO_DASHBOARD : snapshot.data,
    loading: !isDemo && !snapshot.loaded,
    error: isDemo ? null : snapshot.error,
    refresh,
  };
}
