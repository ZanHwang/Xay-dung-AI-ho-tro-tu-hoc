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
  // State updates are async/batched - a rapid double-click could pass the
  // `submitting` state check twice before it flips. A ref guard is
  // synchronous, so it actually blocks the second call.
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  // Topic to open in the read-only "Xem lại kiến thức" dialog (see
  // TopicLearnDialog mode="review") - set from a wrong answer's own topic.
  const [reviewTopic, setReviewTopic] = useState<string | null>(null);
  // Set right before onSwitchQuiz() in retryWrong() so the effect below
  // knows the NEXT quiz.id change (to the retry quiz) should auto-start,
  // without the parent having to know about it.
  const autoStartNextSwitch = useRef(false);
  const sheetRef = useRef<HTMLElement>(null);

  const draft = quizzes.drafts.find((item) => item.quizId === quiz.id);
  const attempt = quizzes.attempts.find((item) => item.id === attemptId && item.quizId === quiz.id);
  const result = attempt ? gradeQuiz(quiz, attempt.answers, attempt.questionIds) : null;
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
        // Persist the result on the backend (spaced-repetition review
        // scheduling). Best-effort: the local grade (UI) still works even
        // if the backend call fails, but the user must be told the result
        // isn't actually saved server-side. submitQuizId (set only for a
        // review/retry-wrong session, see types.ts) posts to the REAL
        // original quiz, scoped to just this session's own questions - never
        // a new quiz, see quiz_service.py::get_due_questions/get_wrong_questions.
        const targetId = quiz.submitQuizId ?? quiz.backendId ?? quiz.id;
        const scopeIds = quiz.submitQuizId ? quiz.questions.map((q) => q.id) : undefined;
        try {
          const res = await quizApi.submit(targetId, draft.answers, undefined, scopeIds);
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
      // The submit button sits at the bottom; bring the score into view.
      sheetRef.current?.closest(".overlay-body")?.scrollTo({ top: 0 });
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
          subjectId: quiz.subjectId, title: `Làm lại câu sai · ${apiQuiz.title}`, difficulty: apiQuiz.difficulty,
          source: "wrong", conversationId: null, questions: apiQuiz.questions,
          backendId: undefined, submitQuizId: apiQuiz.backendId,
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
    <section className="sheet" ref={sheetRef}>
      {error ? (
        <div role="alert" className="error-box"><p>{error}</p></div>
      ) : null}

      {!taking && pastAttempts.length > 1 ? (
        <div className="attempts">
          <span className="meta">Các lần đã làm:</span>
          {pastAttempts.map((item) => {
            const grade = gradeQuiz(quiz, item.answers, item.questionIds);
            return (
              <button
                key={item.id}
                type="button"
                className="attempt-chip"
                aria-pressed={item.id === attemptId}
                onClick={() => { setAttemptId(item.id); setTaking(false); setWrongOnly(false); }}
              >
                <span>{new Date(item.submittedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                <b>{grade.percent}%</b>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="quiz-top">
        {taking ? (
          <div>
            <p>Đã trả lời {quiz.questions.length - unanswered}/{quiz.questions.length} câu</p>
            <div className="meter quiz-meter" aria-hidden="true">
              <span style={{ width: `${quiz.questions.length ? Math.round(((quiz.questions.length - unanswered) * 100) / quiz.questions.length) : 0}%` }} />
            </div>
            <p className="meta">Đáp án và giải thích hiển thị sau khi nộp.</p>
          </div>
        ) : result ? (
          <div className="total" role="status">
            <span className="score-pen big">{result.percent}%</span>
            <div>
              <h2>{result.correct}/{result.total} câu đúng</h2>
              <p className="meta">Câu bỏ trống tính là sai. Làm lại không ghi đè kết quả này.</p>
            </div>
          </div>
        ) : (
          <div>
            <h2>{quiz.questions.length} câu trắc nghiệm</h2>
            <p className="meta">Đáp án và giải thích hiển thị sau khi nộp.</p>
          </div>
        )}
        {taking ? (
          <Button variant="outline" disabled={submitting} onClick={() => { setTaking(false); onTakingChange?.(false); }}>Lưu và tạm dừng</Button>
        ) : (
          <Button onClick={start}>{draft ? "Tiếp tục bài đang làm" : attempt ? "Làm lại" : "Bắt đầu làm bài"}</Button>
        )}
      </div>

      {taking && draft ? (
        <>
          {quiz.questions.map((question, index) => (
            <fieldset key={question.id} className="q-card">
              <legend className="q-head">
                <span className="q-num">Câu {index + 1}</span>
                {question.backendLastCorrect === false ? (
                  <span className="pill pill-amber">Mới trả lời sai, ôn lại ngay</span>
                ) : question.backendLastCorrect === true ? (
                  <span className="pill pill-green">Đã đúng, ôn lại cho nhớ lâu</span>
                ) : null}
              </legend>
              <p className="q-text">{question.prompt}</p>
              {question.options.map((option, optionIndex) => {
                const chosen = draft.answers[question.id] === optionIndex;
                return (
                  <label key={optionIndex} className={chosen ? "option chosen" : "option"}>
                    <input
                      type="radio"
                      disabled={submitting}
                      name={`${draft.id}-${question.id}`}
                      checked={chosen}
                      onChange={() => quizzes.store.answer(draft.id, question.id, optionIndex)}
                      style={{ accentColor: "var(--accent)", marginTop: 6 }}
                    />
                    <span className="key">{String.fromCharCode(65 + optionIndex)}</span>
                    <span className="grow">{option}</span>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <Button size="lg" className="self-start" disabled={submitting} onClick={() => { if (unanswered) setConfirmSubmit(true); else void submit(); }}>
            {submitting ? "Đang nộp bài…" : "Nộp bài"}
          </Button>
        </>
      ) : null}

      {!taking && result ? (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button
              variant="outline"
              disabled={result.total === result.correct || creating}
              onClick={() => void retryWrong()}
            >
              {creating ? "Đang tạo…" : `Làm lại câu sai (${result.total - result.correct})`}
            </Button>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={wrongOnly} onChange={(event) => setWrongOnly(event.target.checked)} style={{ accentColor: "var(--accent)" }} />
              Chỉ xem câu sai ({result.total - result.correct})
            </label>
          </div>
          {wrongOnly && result.correct === result.total ? (
            <p className="ok">Bạn đã trả lời đúng tất cả câu hỏi.</p>
          ) : null}
          {result.items.map((item, index) => (!wrongOnly || !item.correct) ? (
            <article key={item.question.id} className="q-card">
              <div className="q-head">
                <span className="q-num">Câu {index + 1}</span>
                <span className={item.correct ? "pill pill-green" : "pill pill-red"}>{item.correct ? "Đúng" : "Sai"}</span>
              </div>
              <h3 className="q-text">{item.question.prompt}</h3>
              <ul className="answers">
                {item.question.options.map((option, optionIndex) => {
                  const right = optionIndex === item.question.correctIndex;
                  const picked = optionIndex === item.selected;
                  return (
                    <li key={optionIndex} className={right ? "answer right" : picked ? "answer wrong" : "answer"}>
                      <span className="key">{String.fromCharCode(65 + optionIndex)}</span>
                      <span className="grow">{option}</span>
                      {right ? <span className="answer-note">{picked ? "Bạn chọn đúng" : "Đáp án đúng"}</span>
                        : picked ? <span className="answer-note">Bạn chọn</span> : null}
                    </li>
                  );
                })}
              </ul>
              {item.selected === undefined ? <p className="err">Bạn chưa trả lời câu này.</p> : null}
              {item.question.explanation ? <p className="quote">{item.question.explanation}</p> : null}
              {!item.correct && item.question.backendTopic && quiz.documentId ? (
                <Button variant="outline" size="sm" className="mt-1" onClick={() => setReviewTopic(item.question.backendTopic ?? null)}>
                  Xem lại kiến thức
                </Button>
              ) : null}
            </article>
          ) : null)}
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
