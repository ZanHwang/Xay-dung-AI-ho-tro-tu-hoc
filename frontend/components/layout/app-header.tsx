"use client";

import { BellRing } from "lucide-react";
import { useDueReviews } from "@/features/reviews/hooks/use-due-reviews";

// Topbar: title left, "câu cần ôn tập" reminder right. This is the one place
// in the app that's on screen no matter which page the user is on - so the
// reminder lives here, not just on the Dashboard card (which only reaches
// someone already on that one page). Opens the SAME due-review popup as the
// Dashboard card (see LearningWorkspace/useQuizOverlay) - both show the one
// real total, no more mismatched counts.
export function AppHeader({ title, onOpenReview }: { title: string; onOpenReview?: () => void }) {
  const { total } = useDueReviews();

  return (
    <header className="topbar">
      <h1 className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </h1>
      {total > 0 && onOpenReview ? (
        <button
          type="button"
          title="Có câu đến hạn ôn lại (đúng hay sai đều được lên lịch ôn - bấm để làm ngay)"
          onClick={onOpenReview}
          className="stat-chip due"
        >
          <BellRing className="size-4" aria-hidden="true" />
          {total} câu cần ôn
        </button>
      ) : null}
    </header>
  );
}
