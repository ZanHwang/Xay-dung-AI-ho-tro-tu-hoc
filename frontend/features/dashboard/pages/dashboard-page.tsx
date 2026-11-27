"use client";

import {
  ArrowUpRight,
  BellRing,
  BookOpen,
  ChevronRight,
  ClipboardList,
  MessageCircle,
  Target,
} from "lucide-react";
import { SectionHeading } from "@/components/shared/section-heading";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useDueReviews } from "@/features/reviews/hooks/use-due-reviews";
import type { Subject } from "@/features/subjects/types";
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
  /** Opens the shared full-screen quiz popup (see use-quiz-overlay.ts)
   * straight onto an already-resolved local quiz, optionally a specific
   * past attempt. */
  onViewQuiz: (quiz: Quiz, opts?: { attemptId?: string }) => void;
  /** Creates (if needed) and opens the spaced-repetition "Ôn câu đến hạn"
   * quiz in the same popup. */
  onOpenReview: () => void;
};

function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="row-between">
      <h3>{title}</h3>
      {action}
    </div>
  );
}

export function DashboardPage({
  userName,
  quizzes,
  subjects,
  conversations,
  onOpenConversation,
  onNavigate,
  onOpenSubject,
  onViewQuiz,
  onOpenReview,
}: DashboardPageProps) {
  const current = subjects[0];
  const { data: dashboard, loading, error, refresh } = useDashboard();
  const { total: dueTotal } = useDueReviews();
  const recentChats = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);

  const totalSubjects = dashboard?.total_subjects ?? 0;
  const totalQuizzes = dashboard?.total_quizzes ?? 0;
  const avgScore = dashboard?.avg_score ?? 0;
  const recentQuizzes = dashboard?.recent_quizzes ?? [];

  const stats = [
    {
      label: "Môn đang học",
      value: totalSubjects.toString(),
      note: "Quản lý trong trang Môn học",
      icon: BookOpen,
      tone: "cyan" as const,
    },
    {
      label: "Điểm quiz trung bình",
      value: totalQuizzes > 0 ? `${Math.round(avgScore)}%` : "—",
      note: `${totalQuizzes} bài đã làm`,
      icon: Target,
      tone: "amber" as const,
    },
  ];

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

  return (
    <div>
      <div className="view-head">
        <SectionHeading
          eyebrow="Không gian học tập của bạn"
          title={`Chào bạn, ${userName}.`}
          description="Chọn một môn học, tiếp tục cuộc hội thoại hoặc làm Quiz để bắt đầu buổi học hôm nay."
        />
      </div>

      {error && (
        <div role="alert" className="error-box flex items-center justify-between gap-4">
          <p className="flex-1">Không thể tải dữ liệu dashboard.</p>
          <button type="button" onClick={() => void refresh()} className="btn btn-sm btn-danger">
            Thử lại
          </button>
        </div>
      )}

      {/* Spaced-repetition: câu đến hạn ôn hôm nay - cùng 1 số thật với chuông
          header (useDueReviews), bấm vào mở popup chọn quiz để ôn (xem
          LearningWorkspace/useQuizOverlay). */}
      <section className="card" style={{ marginTop: 24, borderColor: dueTotal > 0 ? "var(--c-sky)" : undefined }}>
        <div className="row-between">
          <div className="flex items-center gap-2">
            <BellRing className="size-4" style={{ color: "var(--c-sky)" }} />
            <h3 style={{ margin: 0 }}>Câu đến hạn ôn hôm nay{dueTotal > 0 ? ` (${dueTotal})` : ""}</h3>
          </div>
          {dueTotal > 0 ? (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => onOpenReview()}>
              Ôn ngay <ArrowUpRight className="size-4" />
            </button>
          ) : null}
        </div>
        {dueTotal === 0 ? (
          <p className="sub" style={{ marginTop: 4 }}>Không có câu nào đến hạn ôn hôm nay.</p>
        ) : (
          <p className="meta" style={{ marginTop: 4 }}>Ôn đúng sẽ tăng khoảng nhắc lại lần sau.</p>
        )}
      </section>

      <div className="grid-2 top" style={{ marginTop: 24 }}>
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <section className="card">
          {current ? (
            <>
              <p className="label" style={{ color: "var(--accent-strong)" }}>Mở môn học</p>
              <h3 className="mt-3 text-xl">{current.name}</h3>
              <p className="sub">{current.description}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" className="btn btn-accent" onClick={() => onOpenSubject(current.id)}>
                  Mở môn học <ArrowUpRight className="size-4" />
                </button>
                <button type="button" className="btn btn-outline" onClick={() => onNavigate("tutor")}>
                  Hỏi AI Tutor
                </button>
              </div>
            </>
          ) : (
            <p className="sub">Hãy tạo môn học đầu tiên để bắt đầu.</p>
          )}
        </section>
      </div>

      <div style={{ marginTop: 24 }}>
        <section className="card">
          <CardHeader
            title="Môn học của bạn"
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate("subjects")}>
                Xem tất cả
              </button>
            }
          />
          <div>
            {subjects.slice(0, 3).map((subject) => (
              <button
                type="button"
                key={subject.id}
                onClick={() => onOpenSubject(subject.id)}
                className="list-row"
                style={{ width: "100%", cursor: "pointer", background: "none", border: 0, font: "inherit", color: "inherit", textAlign: "left" }}
              >
                <span className={`subj-ic subj-${subject.accent}`}>{subject.shortName}</span>
                <span className="grow">
                  <span className="title block">{subject.name}</span>
                  <span className="sub2 block">{subject.description}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <section className="card">
          <CardHeader
            title="Quiz gần đây"
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate("subjects")}>
                Xem môn học
              </button>
            }
          />
          <div>
            {loading && recentQuizzes.length === 0 ? (
              <div className="space-y-2">
                <div className="h-12 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
                <div className="h-12 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
                <div className="h-12 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
              </div>
            ) : recentQuizzes.length === 0 ? (
              <p className="sub">Chưa có quiz nào.</p>
            ) : (
              recentQuizzes.slice(0, 5).map((quiz) => (
                <button
                  type="button"
                  key={quiz.id}
                  onClick={() => openRecentQuiz(quiz)}
                  className="list-row"
                  style={{ width: "100%", cursor: "pointer", background: "none", border: 0, font: "inherit", color: "inherit", textAlign: "left" }}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--c-blue-soft)", color: "var(--c-blue-ink)" }}>
                    <ClipboardList className="size-4" />
                  </span>
                  <span className="grow">
                    <span className="title block">{quiz.title}</span>
                    <span className="sub2 block">
                      {new Date(quiz.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}{" "}
                      · {Math.round(quiz.score)}%
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <CardHeader
            title="Chat gần đây"
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate("tutor")}>
                <MessageCircle className="size-4" /> Mở Tutor
              </button>
            }
          />
          <div>
            {recentChats.length === 0 && <p className="sub">Chưa có cuộc hội thoại. Mở Tutor để bắt đầu.</p>}
            {recentChats.map((chat) => (
              <button
                type="button"
                key={chat.id}
                onClick={() => onOpenConversation(chat.id)}
                className="list-row"
                style={{ width: "100%", cursor: "pointer", background: "none", border: 0, font: "inherit", color: "inherit", textAlign: "left" }}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--c-blue-soft)", color: "var(--c-blue-ink)" }}>
                  <MessageCircle className="size-4" />
                </span>
                <span className="grow">
                  <span className="title block">{chat.title}</span>
                  <span className="sub2 block">
                    {chat.classification === "uncertain" ? "Chưa xác định môn" : chat.subjectId === null ? "Hỏi đáp chung" : subjects.find((subject) => subject.id === chat.subjectId)?.name ?? "Môn học không còn tồn tại"} · {chat.messages.length} tin nhắn
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
