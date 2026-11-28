"use client";

import { Plus } from "lucide-react";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useDueReviews } from "@/features/reviews/hooks/use-due-reviews";
import { CreateSubjectDialog } from "@/features/subjects/components/create-subject-dialog";
import { SubjectCard } from "@/features/subjects/components/subject-card";
import type { CreateSubjectInput, Subject } from "@/features/subjects/types";
import type { NavKey } from "@/features/workspace/types";
import type { Conversation } from "@/features/tutor/types";
import type { Quiz } from "@/features/quiz/types";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";

type DashboardPageProps = {
  userName: string;
  quizzes: QuizController;
  subjects: Subject[];
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
  onNavigate: (page: NavKey) => void;
  onOpenSubject: (id: string) => void;
  onCreateSubject: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  /** Opens the shared full-screen quiz popup (see use-quiz-overlay.ts)
   * straight onto an already-resolved local quiz, optionally a specific
   * past attempt. */
  onViewQuiz: (quiz: Quiz, opts?: { attemptId?: string }) => void;
  /** Creates (if needed) and opens the spaced-repetition "Ôn câu đến hạn"
   * quiz in the same popup. */
  onOpenReview: () => void;
};

export function DashboardPage({
  userName,
  quizzes,
  subjects,
  conversations,
  onOpenConversation,
  onNavigate,
  onOpenSubject,
  onCreateSubject,
  onViewQuiz,
  onOpenReview,
}: DashboardPageProps) {
  const { data: dashboard, loading, error, refresh } = useDashboard();
  const { total: dueTotal } = useDueReviews();
  const recentChats = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  const totalQuizzes = dashboard?.total_quizzes ?? 0;
  const avgScore = dashboard?.avg_score ?? 0;
  const recentQuizzes = dashboard?.recent_quizzes ?? [];

  // "Quiz gần đây" items only carry backend ids (quiz_id = Quiz.id, id =
  // QuizResult.id) - resolve them to the matching LOCAL quiz/attempt (synced
  // via quiz-store.ts::mergeFromServer) so the click opens that exact quiz
  // and that exact past submission in the full-screen popup (same one used
  // inside a subject's own "Quiz" tab - see use-quiz-overlay.ts).
  function openRecentQuiz(recent: { id: string; quiz_id: string }) {
    const localQuiz = quizzes.quizzes.find((q) => q.backendId === recent.quiz_id);
    if (!localQuiz) return; // quiz was removed locally since the dashboard snapshot was taken
    // Match on backendResultId, not .id - an attempt just submitted THIS
    // session keeps its local draft UUID as .id (quiz-store.ts::submit),
    // only backendResultId holds the real QuizResult id; an attempt synced
    // from a past session (mergeFromServer) sets id === backendResultId ===
    // result.id, so this one check covers both cases.
    const localAttempt = quizzes.attempts.find((a) => a.backendResultId === recent.id);
    onViewQuiz(localQuiz, { attemptId: localAttempt?.id });
  }

  function subjectOf(chat: Conversation) {
    if (chat.classification === "uncertain") return "Chưa xác định môn";
    if (chat.subjectId === null) return "Hỏi đáp chung";
    return subjects.find((subject) => subject.id === chat.subjectId)?.name ?? "Môn học không còn tồn tại";
  }

  return (
    <div className="page">
      {error && (
        <div role="alert" className="error-box mb-4 flex items-center justify-between gap-4">
          <p className="flex-1">Không tải được số liệu tổng quan.</p>
          <button type="button" onClick={() => void refresh()} className="btn btn-sm btn-danger">
            Thử lại
          </button>
        </div>
      )}

      {/* Spaced-repetition: câu đến hạn ôn hôm nay - cùng 1 số thật với chuông
          header (useDueReviews), bấm vào mở popup chọn quiz để ôn (xem
          LearningWorkspace/useQuizOverlay). */}
      <section className="hello oly">
        <h2>Chào {userName}</h2>
        <div className="today">
          {dueTotal > 0 ? (
            <>
              <div>
                <p><span className="mark-hl">{dueTotal} câu đến hạn ôn hôm nay</span></p>
                <p className="sub" style={{ marginTop: 4 }}>Ôn đúng thì lần nhắc sau sẽ cách xa hơn.</p>
              </div>
              <button type="button" className="btn btn-accent" onClick={() => onOpenReview()}>
                Ôn ngay
              </button>
            </>
          ) : (
            <p>Hôm nay không có câu nào đến hạn ôn.</p>
          )}
        </div>
      </section>

      <section className="dash-block" aria-labelledby="dash-subjects">
        <div className="block-head">
          <h3 id="dash-subjects">Vở của bạn</h3>
          <span className="sub">{subjects.length ? `${subjects.length} môn` : "Tạo môn đầu tiên để bắt đầu"}</span>
          {subjects.length > 0 ? (
            <button type="button" className="link-btn" onClick={() => onNavigate("subjects")}>
              Xem tất cả
            </button>
          ) : null}
        </div>
        <div className="subject-grid">
          {subjects.slice(0, 4).map((subject) => (
            <SubjectCard key={subject.id} subject={subject} onOpen={onOpenSubject} />
          ))}
          <CreateSubjectDialog
            onCreate={onCreateSubject}
            trigger={
              <button type="button" className="cover-new oly">
                <Plus className="size-7" aria-hidden="true" />
                Tạo môn học
              </button>
            }
          />
        </div>
      </section>

      <div className="dash-cols">
        <section className="dash-block" aria-labelledby="dash-grades">
          <div className="block-head">
            <h3 id="dash-grades">Sổ điểm</h3>
            <span className="sub">
              {totalQuizzes > 0 ? `Trung bình ${Math.round(avgScore)}% qua ${totalQuizzes} bài` : ""}
            </span>
          </div>
          {loading && recentQuizzes.length === 0 ? (
            <div className="space-y-2" role="status" aria-label="Đang tải điểm">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-14 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
              ))}
            </div>
          ) : recentQuizzes.length === 0 ? (
            <p className="empty">Chưa có điểm nào. Mở một môn, tạo quiz và làm thử.</p>
          ) : (
            recentQuizzes.slice(0, 5).map((quiz) => (
              <button type="button" key={quiz.id} onClick={() => openRecentQuiz(quiz)} className="row-link">
                <span className="grow">
                  <span className="title">{quiz.title}</span>
                  <span className="sub2">
                    Làm ngày {new Date(quiz.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </span>
                </span>
                <span className="score-pen"><span className="sr-only">Đạt </span>{Math.round(quiz.score)}%</span>
              </button>
            ))
          )}
        </section>

        <section className="dash-block" aria-labelledby="dash-chats">
          <div className="block-head">
            <h3 id="dash-chats">Đang hỏi dở</h3>
            <button type="button" className="link-btn" onClick={() => onNavigate("tutor")}>
              Mở AI Tutor
            </button>
          </div>
          {recentChats.length === 0 ? (
            <p className="empty">Chưa có cuộc hội thoại nào. Mở AI Tutor và hỏi câu đầu tiên.</p>
          ) : (
            recentChats.map((chat) => {
              const count = Math.max(chat.messageCount ?? 0, chat.messages.length);
              return (
                <button type="button" key={chat.id} onClick={() => onOpenConversation(chat.id)} className="row-link">
                  <span className="grow">
                    <span className="title">{chat.title}</span>
                    <span className="sub2">{subjectOf(chat)}, {count} tin nhắn</span>
                  </span>
                </button>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
