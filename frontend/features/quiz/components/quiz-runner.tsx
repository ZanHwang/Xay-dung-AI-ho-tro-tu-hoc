"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Quiz } from "../types";
import type { QuizController } from "../hooks/use-quizzes";
import { quizApi } from "../services/quiz-api";
import { gradeQuiz } from "../services/quiz-engine";
import { TopicLearnDialog } from "@/features/path/components/topic-learn-dialog";

type QuizRunnerProps = {
  quiz: Quiz;
  quizzes: QuizController;
  /** Which past submission to show first (null/undefined = latest, or the
   * "start" prompt when there is none yet). */
  initialAttemptId?: string | null;
  /** Called when a retry ("Làm lại câu sai") creates a different quiz, so
   * the parent can point its `quiz` prop at the new one (this component
   * reacts to the `quiz.id` change itself, no remount needed). */
  onSwitchQuiz: (quizId: string) => void;
  /** Mirrors whether the question form is currently open, so a parent that
   * shows other controls alongside (e.g. the "Tạo Quiz" form) can disable
   * them while the user is mid-attempt. */
  onTakingChange?: (taking: boolean) => void;
  /** True when the parent just created this exact quiz and it should open
   * straight into the question form (e.g. right after "Tạo Quiz"). Leave
   * false when just opening an existing quiz to look at it. */
  autoStart?: boolean;
};

/**
 * One quiz: start/resume/retake it, answer it, see the graded result, and
 * browse past submissions of this same quiz. Used inside the shared
 * full-screen QuizOverlay (quiz-overlay.tsx) - opened from a subject's own
 * "Lịch sử Quiz" card, Dashboard's "Quiz gần đây", or "Ôn câu đến hạn"
 * anywhere in the app (see use-quiz-overlay.ts) - none of those callers own
 * quiz selection beyond "which quiz", so all of that logic lives here.
 */
export function QuizRunner({ quiz, quizzes, initialAttemptId, onSwitchQuiz, onTakingChange, autoStart }: QuizRunnerProps) {
  const [taking, setTaking] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(initialAttemptId ?? null);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  // Topic to open in the read-only "Xem lại kiến thức" dialog (see
  // TopicLearnDialog mode="review") - set from a wrong answer's own topic.
  const [reviewTopic, setReviewTopic] = useState<string | null>(null);
  // Set right before onSwitchQuiz() in retryWrong() so the effect below
  // knows the NEXT quiz.id change (to the retry quiz) should auto-start,
  // without the parent having to know about it.
  const autoStartNextSwitch = useRef(false);

  const draft = quizzes.drafts.find((item) => item.quizId === quiz.id);
  const attempt = quizzes.attempts.find((item) => item.id === attemptId && item.quizId === quiz.id);
  const result = attempt ? gradeQuiz(quiz, attempt.answers) : null;
  const unanswered = draft ? quiz.questions.filter((q) => draft.answers[q.id] === undefined).length : 0;
  const pastAttempts = [...quizzes.attempts]
    .filter((item) => item.quizId === quiz.id)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  function start() {
    quizzes.store.start(quiz.id);
    setAttemptId(null);
    setTaking(true);
    onTakingChange?.(true);
    setWrongOnly(false);
    setError("");
  }

  // Runs on mount and whenever the parent points this at a different quiz
  // or a different past attempt of the SAME quiz (both tracked in one
  // effect so there's a single, deterministic branch instead of two effects
  // racing to set `taking`). Decides whether to open straight into the
  // question form or just show the picked attempt / "start" prompt.
  useEffect(() => {
    if (autoStart || autoStartNextSwitch.current) {
      autoStartNextSwitch.current = false;
      start();
    } else {
      setAttemptId(initialAttemptId ?? null);
      setTaking(false);
      onTakingChange?.(false);
      setWrongOnly(false);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.id, initialAttemptId]);

  async function submit() {
    if (!draft || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const isBackend = ["api", "shared", "wrong", "review"].includes(quiz.source ?? "");
      let backendResultId;
      if (isBackend) {
        // Keep the local grade usable if saving fails, but show the failure.
        try {
          const res = await quizApi.submit(quiz.backendId ?? quiz.id, draft.answers);
          backendResultId = res.id;
        } catch {
          setError("Kết quả chỉ được lưu trên trình duyệt; chưa lưu được lên máy chủ.");
        }
      }
      const id = quizzes.store.submit(draft.id, backendResultId);
      setAttemptId(id);
      setTaking(false);
      onTakingChange?.(false);
      setConfirmSubmit(false);
      setWrongOnly(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function retryWrong() {
    if (!attempt) return;
    setCreating(true);
    setError("");
    try {
      let newQuizId: string;
      if (attempt.backendResultId) {
        const apiQuiz = await quizApi.retryWrong(attempt.backendResultId);
        if (!apiQuiz.questions.length) throw new Error("Không có câu nào cần làm lại.");
        newQuizId = quizzes.store.create({
          subjectId: quiz.subjectId, title: apiQuiz.title, difficulty: apiQuiz.difficulty,
          source: "wrong", conversationId: null, questions: apiQuiz.questions, backendId: apiQuiz.backendId,
        });
      } else if (result) {
        const wrongQuestions = result.items.filter((item) => !item.correct).map((item) => item.question);
        if (!wrongQuestions.length) return;
        newQuizId = quizzes.store.create({
          subjectId: quiz.subjectId, title: `Làm lại câu sai · ${quiz.title}`,
          source: "wrong", conversationId: null, questions: wrongQuestions,
        });
      } else {
        return;
      }
      autoStartNextSwitch.current = true;
      onSwitchQuiz(newQuizId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo Quiz làm lại câu sai.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section>
      <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <h3>{quiz.title}</h3>
        <div style={{ display: "flex", gap: 12 }}>
          {!taking ? <Button onClick={start}>{draft ? "Tiếp tục bài đang làm" : attempt ? "Làm lại" : "Bắt đầu làm bài"}</Button> : null}
          {taking ? <Button variant="ghost" disabled={submitting} onClick={() => { setTaking(false); onTakingChange?.(false); }}>Lưu và tạm dừng</Button> : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="error-box" style={{ marginTop: 12 }}><p>{error}</p></div>
      ) : null}

      {!taking && pastAttempts.length > 1 ? (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="meta" style={{ alignSelf: "center" }}>Các lần đã làm:</span>
          {pastAttempts.map((item) => {
            const grade = gradeQuiz(quiz, item.answers);
            const active = item.id === attemptId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setAttemptId(item.id); setTaking(false); setWrongOnly(false); }}
                className={active ? "pill pill-green" : "pill pill-grey"}
                style={{ cursor: "pointer" }}
              >
                {new Date(item.submittedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} · {grade.percent}%
              </button>
            );
          })}
        </div>
      ) : null}

      {taking && draft ? (
        <>
          <p className="meta" style={{ marginTop: 12 }}>Đã trả lời {quiz.questions.length - unanswered}/{quiz.questions.length} câu. Đáp án và giải thích hiển thị sau khi nộp.</p>
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
            {quiz.questions.map((question, index) => (
              <fieldset key={question.id} style={{ margin: 0, padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <legend style={{ padding: 0, margin: 0, fontSize: 14, fontWeight: 600 }}>Câu {index + 1}{question.topic ? ` · ${question.topic}` : ""}</legend>
                <p style={{ marginBottom: 16, whiteSpace: "pre-wrap" }}>{question.prompt}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {question.options.map((option, optionIndex) => {
                    const chosen = draft.answers[question.id] === optionIndex;
                    return (
                      <label key={optionIndex} className="option" style={{ cursor: "pointer", borderColor: chosen ? "var(--ink)" : "var(--border)" }}>
                        <input
                          type="radio"
                          disabled={submitting}
                          name={`${draft.id}-${question.id}`}
                          checked={chosen}
                          onChange={() => quizzes.store.answer(draft.id, question.id, optionIndex)}
                          style={{ accentColor: "var(--accent)", marginTop: 4 }}
                        />
                        <span className="key">{String.fromCharCode(65 + optionIndex)}</span>
                        <span className="grow">{option}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <Button style={{ marginTop: 24 }} disabled={submitting} onClick={() => { if (unanswered) setConfirmSubmit(true); else void submit(); }}>
            {submitting ? "Đang nộp bài…" : "Nộp bài"}
          </Button>
        </>
      ) : null}

      {!taking && result ? (
        <>
          <p role="status" style={{ marginTop: 16, fontSize: 24, fontWeight: 700, color: "var(--accent-strong)" }}>{result.correct}/{result.total} câu đúng · {result.percent}%</p>
          <p className="meta" style={{ marginTop: 8 }}>Câu bỏ trống được tính là sai. Làm lại tạo một lần nộp mới, không ghi đè kết quả này.</p>

          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <Button
              variant="outline"
              disabled={result.total === result.correct || creating}
              onClick={() => void retryWrong()}
            >
              {creating ? "Đang tạo…" : `Làm lại câu sai (${result.total - result.correct})`}
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wrongOnly} onChange={(event) => setWrongOnly(event.target.checked)} style={{ accentColor: "var(--accent)" }} />
              Chỉ xem câu sai ({result.total - result.correct})
            </label>
          </div>
          {wrongOnly && result.correct === result.total ? (
            <p className="meta" style={{ marginTop: 16, color: "var(--accent-strong)" }}>Bạn đã trả lời đúng tất cả câu hỏi.</p>
          ) : null}
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {result.items.map((item) => (!wrongOnly || !item.correct) ? (
              <article key={item.question.id} style={{ border: `1px solid ${item.correct ? "var(--accent)" : "var(--error)"}`, background: item.correct ? "var(--accent-soft)" : "var(--error-soft)", borderRadius: "var(--radius-md)", padding: 16 }}>
                <h3 style={{ margin: 0, lineHeight: 1.5 }}>{item.question.prompt}</h3>
                <span
                  className="pill"
                  style={{ marginTop: 10, display: "inline-block", background: item.correct ? "var(--accent)" : "var(--error)", color: "#fff", fontWeight: 600 }}
                >
                  {item.correct ? "Đúng" : "Sai"}
                </span>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
                  Bạn chọn: {item.selected === undefined ? "Chưa trả lời" : item.question.options[item.selected]}
                </p>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: "var(--accent-strong)" }}>Đáp án đúng: {item.question.options[item.question.correctIndex]}</p>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>{item.question.explanation}</p>
                {!item.correct && item.question.backendTopic && quiz.documentId ? (
                  <Button variant="outline" size="sm" style={{ marginTop: 10 }} onClick={() => setReviewTopic(item.question.backendTopic ?? null)}>
                    Xem lại kiến thức
                  </Button>
                ) : null}
              </article>
            ) : null)}
          </div>
        </>
      ) : null}

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nộp bài chưa hoàn thành?</DialogTitle>
            <DialogDescription>Còn {unanswered} câu chưa trả lời. Những câu này được tính là sai.</DialogDescription>
          </DialogHeader>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" disabled={submitting} onClick={() => setConfirmSubmit(false)}>Tiếp tục làm</Button>
            <Button disabled={submitting} onClick={() => void submit()}>{submitting ? "Đang nộp…" : "Vẫn nộp bài"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <TopicLearnDialog
        subjectId={quiz.subjectId}
        documentId={quiz.documentId ?? null}
        topic={reviewTopic}
        open={reviewTopic !== null}
        onClose={() => setReviewTopic(null)}
        mode="review"
      />
    </section>
  );
}
