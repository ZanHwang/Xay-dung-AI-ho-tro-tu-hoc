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
import { byRecentUse, type CreateSubjectInput, type Subject } from "@/features/subjects/types";
import { useContinueTopic, type ContinueHome, type ContinueTopic } from "@/features/path/hooks/use-continue-topic";
import { ScoreRow, dayMonth } from "@/features/grades/components/score-row";
import { useOpenResult } from "@/features/quiz/hooks/use-open-result";
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

/** How many subjects, scores and conversations Hôm nay shows; the rest are a click away. */
const SHOWN_SUBJECTS = 4;
const SHOWN_ROWS = 5;

/** What to say when there is no topic to continue - see ContinueHome.state. */
function noTopicNote(state: ContinueHome["state"], hasSubjects: boolean) {
  if (state === "preparing") return { title: "Lộ trình đang được chuẩn bị", text: "Tài liệu đang được xử lý. Lộ trình sẽ hiện ở đây khi xong.", action: false };
  if (state === "finished") return { title: "Bạn đã học hết các chủ đề", text: "Ôn các câu đến hạn, hoặc thêm tài liệu mới để học tiếp.", action: false };
  return {
    title: "Chưa có lộ trình",
    text: hasSubjects
      ? "Thêm tài liệu PDF vào một môn, app sẽ chia thành các chủ đề để học dần."
      : "Tạo một môn rồi thêm tài liệu PDF, app sẽ chia thành các chủ đề để học dần.",
    action: true,
  };
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

  // Hỏi gần đây: the questions asked in Hỏi AI. A lesson's own Q&A ("Học")
  // stays in that lesson.
  const recentChats = conversations
    .filter((chat) => !chat.topic)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, SHOWN_ROWS);

  const totalQuizzes = dashboard?.total_quizzes ?? 0;
  const avgScore = dashboard?.avg_score ?? 0;
  const recentQuizzes = dashboard?.recent_quizzes ?? [];

  const subjectById = (id: string | null | undefined) => subjects.find((subject) => subject.id === id);
  const subjectOfQuiz = (backendId: string) =>
    subjectById(quizzes.quizzes.find((quiz) => quiz.backendId === backendId)?.subjectId);
  const shownSubjects = byRecentUse(subjects).slice(0, SHOWN_SUBJECTS);

  // "Học tiếp" and the road below it follow the same server-chosen document;
  // the road can switch to the other documents still being learned.
  const { home, reload } = useContinueTopic();
  const next = home?.next ?? null;
  const nextSubject = subjectById(next?.subjectId);
  const doneCount = next?.topics.filter((item) => item.state === "done").length ?? 0;
  const note = home && !next && home.state !== "ready" ? noTopicNote(home.state, subjects.length > 0) : null;

  // A score row opens that exact submission in the quiz popup, fetching it
  // first when this browser doesn't hold it (see use-open-result.ts).
  const opener = useOpenResult(quizzes, onViewQuiz);

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

        {next && nextSubject ? (
          <section className="task cover-cyan">
            <Paperclip className="clip" aria-hidden="true" />
            <div>
              <h2>Học tiếp: {next.topic}</h2>
              <p>{nextSubject.name}, đã xong {doneCount} trên {next.topics.length} chủ đề</p>
              <p style={{ overflowWrap: "anywhere" }}>Tài liệu: {next.documentName}</p>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${(doneCount / next.topics.length) * 100}%` }} />
              </div>
            </div>
            <button type="button" className="btn btn-accent" onClick={() => setLearning(next)}>
              Học
            </button>
          </section>
        ) : note ? (
          <section className="task cover-cyan">
            <Paperclip className="clip" aria-hidden="true" />
            <div>
              <h2>{note.title}</h2>
              <p>{note.text}</p>
            </div>
            {note.action ? (
              <button type="button" className="btn btn-outline" onClick={() => onNavigate("subjects")}>
                Mở Môn học
              </button>
            ) : null}
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
          {shownSubjects.map((subject) => (
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

      {next && nextSubject ? (
        <LearningRoad
          roads={[next, ...(home?.others ?? [])]}
          subjects={subjects}
          onOpenPath={(subjectId) => onOpenSubject(subjectId, "path")}
        />
      ) : null}
      </div>

      <div className="today-side">
        <section className="dash-block" aria-labelledby="dash-grades">
          <div className="block-head">
            <h2 id="dash-grades" className="block-title">Sổ điểm</h2>
            <span className="sub">
              {totalQuizzes > 0 ? `Trung bình ${Math.round(avgScore)}% qua ${totalQuizzes} bài` : ""}
            </span>
            {recentQuizzes.length > 0 ? (
              <button type="button" className="link-btn" onClick={() => onNavigate("grades")}>
                Xem tất cả
              </button>
            ) : null}
          </div>
          {opener.error ? <p role="alert" className="meta">{opener.error}</p> : null}
          {loading && recentQuizzes.length === 0 ? (
            <div className="space-y-2" role="status" aria-label="Đang tải điểm">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-14 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
              ))}
            </div>
          ) : recentQuizzes.length === 0 ? (
            <p className="empty">Chưa có điểm nào. Mở một môn, tạo quiz và làm thử.</p>
          ) : (
            recentQuizzes.slice(0, SHOWN_ROWS).map((quiz) => (
              <ScoreRow
                key={quiz.id}
                row={quiz}
                subject={subjectById(quiz.subject_id) ?? subjectOfQuiz(quiz.quiz_id)}
                busy={opener.opening === quiz.id}
                onOpen={(row) => void opener.open(row.quiz_id, row.id)}
              />
            ))
          )}
        </section>

        <section className="dash-block" aria-labelledby="dash-chats">
          <div className="block-head">
            <h2 id="dash-chats" className="block-title">Hỏi gần đây</h2>
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
        onClose={() => { setPracticeQuizId(null); reload(); void refresh(); }}
        onSwitchQuiz={() => {}}
      />
    </div>
  );
}
