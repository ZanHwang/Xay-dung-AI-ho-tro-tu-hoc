import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Subject } from "@/features/subjects/types";
import type { Quiz } from "../types";
import type { QuizController } from "../hooks/use-quizzes";
import { gradeQuiz } from "../services/quiz-engine";
import { quizApi } from "../services/quiz-api";
import { QuizOverlay } from "./quiz-overlay";
import { QuizCreateDialog } from "./quiz-create-dialog";

export function SubjectQuizSummary({ subject, quizzes }: {
  subject: Subject; quizzes: QuizController;
}) {
  const items = quizzes.quizzes.filter((quiz) => quiz.subjectId === subject.id);
  const [viewing, setViewing] = useState<Quiz | null>(null);
  const [viewAutoStart, setViewAutoStart] = useState(false);
  const [viewAttemptId, setViewAttemptId] = useState<string | null>(null);
  // Forces QuizOverlay to remount on every open, even re-opening the same
  // quiz (e.g. "Xem" then "Làm lại") — guarantees a fresh internal state
  // instead of depending on initialAttemptId happening to differ.
  const [viewToken, setViewToken] = useState(0);
  const [renaming, setRenaming] = useState<Quiz | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Quiz | null>(null);
  const [actionError, setActionError] = useState("");

  // Latest attempt only — a quiz can be retaken, the most recent submission
  // is the one worth showing (list row's score, and what the overlay opens
  // to by default).
  function latestAttemptOf(quizId: string) {
    return [...quizzes.attempts]
      .filter((attempt) => attempt.quizId === quizId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  }

  function openView(quiz: Quiz, autoStart: boolean) {
    setActionError("");
    setViewing(quiz);
    // Snapshot only when opening. A newly submitted result must not rerun
    // QuizRunner's initialization and auto-start another draft.
    setViewAttemptId(latestAttemptOf(quiz.id)?.id ?? null);
    setViewAutoStart(autoStart);
    setViewToken((token) => token + 1);
  }

  async function confirmDelete() {
    if (!deleting) return;
    const quiz = deleting;
    quizzes.store.remove(quiz.id);
    setDeleting(null);
    if (quiz.backendId) {
      try {
        await quizApi.remove(quiz.backendId);
      } catch {
        // Best-effort: the quiz is already gone locally either way.
      }
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <h3>Lịch sử Quiz</h3>
        <QuizCreateDialog
          subject={subject}
          quizzes={quizzes}
          onCreated={(id) => { const quiz = quizzes.store.getSnapshot().quizzes.find((item) => item.id === id); if (quiz) openView(quiz, true); }}
        />
      </div>
      {items.length === 0 ? (
        <p className="meta" style={{ marginTop: 16 }}>Chưa có quiz nào trong môn này.</p>
      ) : (
        <div className="scroll-list" style={{ marginTop: 16 }}>
          {items.map((quiz) => {
            const latest = latestAttemptOf(quiz.id);
            const percent = latest ? gradeQuiz(quiz, latest.answers).percent : null;
            const date = latest
              ? new Date(latest.submittedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
              : null;

            return (
              <div key={quiz.id} className="list-row" style={{ flexWrap: "wrap" }}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--c-blue-soft)", color: "var(--c-blue-ink)" }}>
                  <ClipboardList className="size-4" />
                </span>
                <span className="grow">
                  <span className="title block">{quiz.title}</span>
                  <span className="sub2 block">
                    {quiz.questions.length} câu · {percent !== null ? `${percent}% · ${date}` : "Chưa nộp"}
                  </span>
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <Button variant="outline" size="sm" onClick={() => openView(quiz, false)} aria-label={`Xem ${quiz.title}`}>
                    Xem
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openView(quiz, true)} aria-label={`Làm lại ${quiz.title}`}>
                    Làm lại
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setActionError(""); setRenameValue(quiz.title); setRenaming(quiz); }}
                    aria-label={`Đổi tên ${quiz.title}`}
                  >
                    Đổi tên
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setActionError(""); setDeleting(quiz); }}
                    style={{ color: "var(--error)" }}
                    aria-label={`Xóa ${quiz.title}`}
                  >
                    Xóa
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <QuizOverlay
        key={viewToken}
        quiz={viewing}
        quizzes={quizzes}
        initialAttemptId={viewAttemptId}
        autoStart={viewAutoStart}
        onClose={() => setViewing(null)}
        onSwitchQuiz={(id) => {
          const next = quizzes.store.getSnapshot().quizzes.find((item) => item.id === id);
          if (next) openView(next, true);
        }}
      />

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đổi tên quiz</DialogTitle>
            <DialogDescription>Đặt tên khác để dễ phân biệt với các quiz khác.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="Tên quiz"
            className="input"
            aria-label="Tên quiz"
          />
          {actionError ? (
            <div role="alert" className="error-box"><p>{actionError}</p></div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Hủy</Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                if (!renaming) return;
                quizzes.store.rename(renaming.id, renameValue);
                setRenaming(null);
              }}
            >
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xóa quiz?</DialogTitle>
            <DialogDescription>
              &quot;{deleting?.title}&quot; và lịch sử làm bài của quiz này sẽ bị xóa. Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Hủy</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>Xóa quiz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
