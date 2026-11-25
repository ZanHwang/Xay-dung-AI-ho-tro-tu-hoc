"use client";

import { useEffect, useState } from "react";
import { BookOpen, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import { pathApi, type TopicLesson, type TopicChatMessage } from "../services/path-api";

/**
 * "Học" screen for one Lộ trình topic: AI summary + source excerpts (both at
 * once - neither alone was enough) + a small free-form AI Q&A, since users
 * often want to ask follow-ups right there. In "full" mode it also offers
 * "Luyện tập" (auto-creates the topic's quiz via pathApi.startPractice,
 * registers it in the local quiz store, then hands the new local quiz id to
 * `onPracticeCreated` so the CALLER opens it in its own QuizOverlay — kept
 * out of this component to avoid a quiz-runner.tsx -> topic-learn-dialog.tsx
 * -> quiz-overlay.tsx -> quiz-runner.tsx import cycle, since quiz-runner.tsx
 * also opens this dialog for mode="review"). In "review" mode (opened from a
 * wrong answer in a quiz result) it's read-only: summary + excerpts only, no
 * practice/chat - just "what should I re-read".
 */
export function TopicLearnDialog({
  subjectId, documentId, topic, open, onClose, mode, quizzes, onPracticeCreated,
}: {
  subjectId: string;
  /** Which document this topic belongs to - required whenever `topic` is
   * set (lesson/practice/chat are all scoped to this one document now). */
  documentId: string | null;
  topic: string | null;
  open: boolean;
  onClose: () => void;
  mode: "full" | "review";
  /** Required when mode="full". */
  quizzes?: QuizController;
  /** Called with the newly-created practice quiz's LOCAL id (store id, not
   * backendId) right after it's registered in the store - the caller should
   * open it (e.g. in its own QuizOverlay) and, once that closes, refetch
   * topic progress (it may have just unlocked the next topic). */
  onPracticeCreated?: (localQuizId: string) => void;
}) {
  const [lesson, setLesson] = useState<TopicLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [chat, setChat] = useState<TopicChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open || !topic || !documentId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setChat([]);
    setConversationId(null);
    pathApi.getLesson(subjectId, documentId, topic)
      .then((data) => { if (!cancelled) setLesson(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được nội dung học."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, subjectId, documentId, topic]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || !topic || !documentId || asking) return;
    setAsking(true);
    setChat((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    try {
      const { answer, conversationId: cid } = await pathApi.askAboutTopic(subjectId, documentId, topic, q, conversationId);
      setConversationId(cid);
      setChat((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err) {
      setChat((prev) => [...prev, { role: "assistant", content: err instanceof Error ? err.message : "Không hỏi được AI lúc này." }]);
    } finally {
      setAsking(false);
    }
  }

  async function handleStartPractice() {
    if (!topic || !documentId || starting || !quizzes) return;
    setStarting(true);
    setError("");
    try {
      const quiz = await pathApi.startPractice(subjectId, documentId, topic);
      const id = quizzes.store.create({
        subjectId, title: quiz.title, difficulty: quiz.difficulty,
        source: "shared", conversationId: null, questions: quiz.questions, backendId: quiz.backendId,
      });
      onPracticeCreated?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được bài luyện tập.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4" style={{ color: "var(--accent-strong)" }} /> {topic}
          </DialogTitle>
          <DialogDescription>
            {mode === "full" ? "Xem lại kiến thức trước khi luyện tập." : "Kiến thức liên quan tới câu bạn vừa làm sai."}
          </DialogDescription>
        </DialogHeader>

        {error ? <div role="alert" className="error-box"><p>{error}</p></div> : null}

        {loading ? (
          <p className="meta" style={{ marginTop: 12 }}>Đang tải…</p>
        ) : lesson ? (
          <div className="space-y-4 py-2">
            <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>{lesson.summary}</p>

            {lesson.excerpts.length > 0 ? (
              <div>
                <p className="label" style={{ marginBottom: 8 }}>Trích đoạn gốc trong tài liệu</p>
                <div className="scroll-list">
                  {lesson.excerpts.map((excerpt, index) => (
                    <div key={index} className="list-row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                      <span className="grow">
                        <span className="title block">{excerpt.documentName}{excerpt.page ? ` · Trang ${excerpt.page}` : ""}</span>
                        <span className="sub2 block" style={{ whiteSpace: "pre-wrap" }}>{excerpt.content}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === "full" ? (
              <div>
                <p className="label" style={{ marginBottom: 8 }}>Hỏi thêm AI về chủ đề này</p>
                {chat.length > 0 ? (
                  <div className="scroll-list" style={{ marginBottom: 8 }}>
                    {chat.map((m, i) => (
                      <p key={i} className="meta" style={{ padding: "6px 0", fontWeight: m.role === "user" ? 600 : 400 }}>
                        {m.role === "user" ? "Bạn: " : "AI: "}{m.content}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input"
                    placeholder="Nhập câu hỏi…"
                    value={question}
                    disabled={asking}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAsk(); } }}
                  />
                  <Button variant="outline" size="icon" disabled={asking || !question.trim()} onClick={() => void handleAsk()} aria-label="Gửi câu hỏi">
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          {mode === "full" ? (
            <Button onClick={() => void handleStartPractice()} disabled={starting || loading}>
              {starting ? "Đang tạo bài…" : "Luyện tập"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
