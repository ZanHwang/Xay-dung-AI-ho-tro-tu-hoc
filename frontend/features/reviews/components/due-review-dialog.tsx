"use client";

import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DueQuizSummary } from "../services/review-api";

/**
 * Shared popup opened from both the header bell and the Dashboard card
 * (see AppHeader/DashboardPage's `onOpenReview` -> useQuizOverlay's
 * `openDueDialog`): lists the quizzes that currently have due questions so
 * the user picks ONE to review, instead of a single quiz mixing questions
 * from every subject at once.
 */
export function DueReviewDialog({ open, quizzes, onClose, onPick }: {
  open: boolean;
  quizzes: DueQuizSummary[];
  onClose: () => void;
  onPick: (quizId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Câu cần ôn hôm nay</DialogTitle>
          <DialogDescription>
            Chọn 1 quiz để ôn đúng các câu đến hạn trong quiz đó.
          </DialogDescription>
        </DialogHeader>
        {quizzes.length === 0 ? (
          <p className="sub">Không có câu nào đến hạn.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {quizzes.map((quiz) => (
              <button
                key={quiz.quiz_id}
                type="button"
                className="list-row"
                onClick={() => onPick(quiz.quiz_id)}
                style={{ width: "100%", cursor: "pointer", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", font: "inherit", color: "inherit", textAlign: "left" }}
              >
                <span className="grow title block">{quiz.title}</span>
                <span className="pill pill-grey" style={{ flexShrink: 0 }}>{quiz.due_count} câu</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
