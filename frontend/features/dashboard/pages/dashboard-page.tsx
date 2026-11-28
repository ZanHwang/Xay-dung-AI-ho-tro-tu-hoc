"use client";

import { useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { LearningRoad } from "@/features/dashboard/components/learning-road";
import { WeekActivity } from "@/features/dashboard/components/week-activity";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useDueReviews } from "@/features/reviews/hooks/use-due-reviews";
import { CreateSubjectDialog } from "@/features/subjects/components/create-subject-dialog";
import { SubjectCard } from "@/features/subjects/components/subject-card";
import type { SubjectTab } from "@/features/subjects/components/subject-detail";
import type { CreateSubjectInput, Subject } from "@/features/subjects/types";
import { useContinueTopic, type ContinueTopic } from "@/features/path/hooks/use-continue-topic";
import { TopicLearnDialog } from "@/features/path/components/topic-learn-dialog";
import { QuizOverlay } from "@/features/quiz/components/quiz-overlay";
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
  onOpenSubject: (id: string, tab?: SubjectTab) => void;
  onCreateSubject: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  /** Opens the shared full-screen quiz popup (see use-quiz-overlay.ts)
   * straight onto an already-resolved local quiz, optionally a specific
   * past attempt. */
  onViewQuiz: (quiz: Quiz, opts?: { attemptId?: string }) => void;
  /** Creates (if needed) and opens the spaced-repetition "Ôn câu đến hạn"
   * quiz in the same popup. */
  onOpenReview: () => void;
};

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function dayMonth(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayLabel(now = new Date()) {
  return `${WEEKDAYS[now.getDay()]}, ${dayMonth(now)}`;
}

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
  const [learning, setLearning] = useState<ContinueTopic | null>(null);
  const [practiceQuizId, setPracticeQuizId] = useState<string | null>(null);

  const recentChats = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  const totalQuizzes = dashboard?.total_quizzes ?? 0;
  const avgScore = dashboard?.avg_score ?? 0;
  const recentQuizzes = dashboard?.recent_quizzes ?? [];

  const subjectById = (id: string | null | undefined) => subjects.find((subject) => subject.id === id);
  const subjectOfQuiz = (backendId: string) =>
    subjectById(quizzes.quizzes.find((quiz) => quiz.backendId === backendId)?.subjectId);

  // "Học tiếp": look at the subjects used most recently (last quiz, last chat),
  // then any subject that has documents.
  const candidates = loading
    ? []
    : Array.from(new Set([
        ...recentQuizzes.map((recent) => subjectOfQuiz(recent.quiz_id)?.id),
        ...recentChats.map((chat) => subjectById(chat.subjectId)?.id),
        ...subjects.filter((subject) => (subject.documentCount ?? 0) > 0).map((subject) => subject.id),
      ].filter((id): id is string => Boolean(id))));
  const next = useContinueTopic(candidates);
  const nextSubject = subjectById(next.topic?.subjectId);
  const doneCount = next.topic?.topics.filter((item) => item.state === "done").length ?? 0;

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

  function chatSubjectLabel(chat: Conversation) {
    if (chat.classification === "uncertain") return "Chưa xác định môn";
    if (chat.subjectId === null) return "Hỏi đáp chung";
    return subjectById(chat.subjectId)?.name ?? "Môn học không còn tồn tại";
  }

  return (
    <div className="today-grid">
      <div className="today-main">
      {error && (
        <div role="alert" className="error-box mb-4 flex items-center justify-between gap-4">
          <p className="flex-1">Không tải được số liệu của hôm nay.</p>
          <button type="button" onClick={() => void refresh()} className="btn btn-sm btn-danger">
            Thử lại
          </button>
        </div>
      )}

      <header className="hello">
        <span className="tape t1" aria-hidden="true" />
        <h1>Chào {userName}</h1>
        <p>{todayLabel()}</p>
      </header>

      <div className="tasks">
        {/* Spaced-repetition: câu đến hạn ôn hôm nay - cùng 1 số thật với huy
            hiệu cạnh "Hôm nay" ở thanh bên (useDueReviews), bấm vào mở popup
            chọn quiz để ôn (xem LearningWorkspace/useQuizOverlay). */}
        <section className="task cover-amber">
          <span className="tape t2" aria-hidden="true" />
          <div>
            <h2>{dueTotal > 0 ? `${dueTotal} câu đến hạn ôn` : "Không có câu nào đến hạn"}</h2>
            <p>{dueTotal > 0 ? "Ôn đúng thì lần nhắc sau cách xa hơn." : "Làm quiz để có lịch ôn cho các ngày tới."}</p>
          </div>
          {dueTotal > 0 ? (
            <button type="button" className="btn btn-accent" onClick={() => onOpenReview()}>
              Ôn ngay
            </button>
          ) : null}
        </section>

        {next.topic && nextSubject ? (
          <section className="task cover-cyan">
            <Paperclip className="clip" aria-hidden="true" />
            <div>
              <h2>Học tiếp: {next.topic.topic}</h2>
              <p>{nextSubject.name}, đã xong {doneCount} trên {next.topic.topics.length} chủ đề</p>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${(doneCount / next.topic.topics.length) * 100}%` }} />
              </div>
            </div>
            <button type="button" className="btn btn-accent" onClick={() => setLearning(next.topic)}>
              Học
            </button>
          </section>
        ) : null}
      </div>

      <section className="dash-block" aria-labelledby="dash-subjects">
        <div className="block-head">
          <h2 id="dash-subjects" className="block-title">Môn học</h2>
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
              <button type="button" className="cover-new">
                <Plus className="size-7" aria-hidden="true" />
                Tạo môn học
              </button>
            }
          />
        </div>
      </section>

      {next.topic && nextSubject ? (
        <LearningRoad road={next.topic} onOpenPath={() => onOpenSubject(nextSubject.id, "path")} />
      ) : null}
      </div>

      <div className="today-side">
        <section className="dash-block" aria-labelledby="dash-grades">
          <div className="block-head">
            <h2 id="dash-grades" className="block-title">Sổ điểm</h2>
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
            recentQuizzes.slice(0, 5).map((quiz) => {
              const subject = subjectOfQuiz(quiz.quiz_id);
              const date = dayMonth(new Date(quiz.created_at));
              return (
                <button type="button" key={quiz.id} onClick={() => openRecentQuiz(quiz)} className="row-link">
                  <span className={`spine-dot ${subject ? `cover-${subject.accent}` : ""}`} aria-hidden="true" />
                  <span className="grow">
                    <span className="title">{quiz.title}</span>
                    <span className="sub2">{subject ? `${subject.name}, ngày ${date}` : `Làm ngày ${date}`}</span>
                  </span>
                  <span className="score-pen"><span className="sr-only">Đạt </span>{Math.round(quiz.score)}%</span>
                </button>
              );
            })
          )}
        </section>

        <section className="dash-block" aria-labelledby="dash-chats">
          <div className="block-head">
            <h2 id="dash-chats" className="block-title">Đang hỏi dở</h2>
            <button type="button" className="link-btn" onClick={() => onNavigate("tutor")}>
              Mở Hỏi AI
            </button>
          </div>
          {recentChats.length === 0 ? (
            <p className="empty">Chưa có cuộc hội thoại nào. Mở Hỏi AI và hỏi câu đầu tiên.</p>
          ) : (
            recentChats.map((chat) => {
              const subject = subjectById(chat.subjectId);
              const count = Math.max(chat.messageCount ?? 0, chat.messages.length);
              return (
                <button type="button" key={chat.id} onClick={() => onOpenConversation(chat.id)} className="row-link">
                  <span className={`spine-dot ${subject ? `cover-${subject.accent}` : ""}`} aria-hidden="true" />
                  <span className="grow">
                    <span className="title">{chat.title}</span>
                    <span className="sub2">{chatSubjectLabel(chat)}, {count} tin nhắn</span>
                  </span>
                </button>
              );
            })
          )}
        </section>

        <WeekActivity attempts={quizzes.attempts} />
      </div>

      <TopicLearnDialog
        subjectId={learning?.subjectId ?? ""}
        documentId={learning?.documentId ?? null}
        topic={learning?.topic ?? null}
        open={learning !== null}
        onClose={() => setLearning(null)}
        mode="full"
        quizzes={quizzes}
        onPracticeCreated={(localQuizId) => { setLearning(null); setPracticeQuizId(localQuizId); }}
      />
      <QuizOverlay
        quiz={quizzes.quizzes.find((item) => item.id === practiceQuizId) ?? null}
        quizzes={quizzes}
        autoStart
        onClose={() => { setPracticeQuizId(null); next.reload(); void refresh(); }}
        onSwitchQuiz={() => {}}
      />
    </div>
  );
}
