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
            Chọn một quiz để ôn các câu đến hạn trong quiz đó.
          </DialogDescription>
        </DialogHeader>
        {quizzes.length === 0 ? (
          <p className="sub">Không có câu nào đến hạn.</p>
        ) : (
          <div className="scroll-list">
            {quizzes.map((quiz) => (
              <button
                key={quiz.quiz_id}
                type="button"
                className="row-link"
                onClick={() => onPick(quiz.quiz_id)}
              >
                <span className="grow title">{quiz.title}</span>
                <span className="pill pill-amber">{quiz.due_count} câu</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
