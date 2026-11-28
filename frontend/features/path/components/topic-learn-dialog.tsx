"use client";

import { useEffect, useState } from "react";
import { BookOpen, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import { pathApi, type TopicLesson, type TopicChatMessage, type TopicExcerpt } from "../services/path-api";
import { MarkdownContent } from "@/features/tutor/components/markdown-content";
import { downloadDocumentPage } from "@/features/subjects/services/document-api";

/**
 * RAG returns excerpts ordered by relevance to the topic (vector similarity),
 * not by page - and overlapping chunks can report the same page twice. Fine
 * for feeding the AI summary, but confusing once shown as stacked slide
 * images (jumps around, can repeat a page) - reorder by page ascending and
 * drop repeats just for display. Excerpts with no page are dropped too: with
 * no slide image to show they were just a bare filename row (the backend
 * stops storing them for new lessons, but lessons cached earlier still have
 * them).
 */
function orderExcerptsForDisplay(excerpts: TopicExcerpt[]): TopicExcerpt[] {
  const seenPages = new Set<string>();
  const unique = excerpts.filter((e) => {
    if (!e.page || seenPages.has(e.page)) return false;
    seenPages.add(e.page);
    return true;
  });
  return unique.sort((a, b) => Number(a.page) - Number(b.page));
}

// Loads the auth-protected page-image endpoint (bearer header, so a plain
// <img src> can't be used) into an object URL - same pattern as
// chat-message.tsx::FigureThumb.
function ExcerptPage({ documentId, page }: { documentId: string; page: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const pageNo = Number(page);
    if (!Number.isInteger(pageNo) || pageNo <= 0) return;
    let revoked = false;
    let objectUrl: string | null = null;
    downloadDocumentPage(documentId, pageNo)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, page]);
  if (!url) return null;
  return <img src={url} alt={`Trang ${page}`} loading="lazy" className="mt-2 block w-full max-h-[640px] rounded-md border border-border object-contain" />;
}

function Excerpt({ excerpt, documentId }: { excerpt: TopicExcerpt; documentId: string }) {
  return (
    <div className="list-row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
      <span className="grow">
        <span className="title block">{excerpt.documentName}{excerpt.page ? ` · Trang ${excerpt.page}` : ""}</span>
        {/* excerpt.content (raw OCR'd text, used internally as the AI's own
            context) is deliberately NOT shown here - with the real slide
            image below, it only ever duplicated the same page, badly (OCR
            garbles math/formulas), never adding anything a person could read
            better than the image itself. */}
        {excerpt.page ? <ExcerptPage documentId={documentId} page={excerpt.page} /> : null}
      </span>
    </div>
  );
}

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
 *
 * Full-bleed panel (not a centered modal) - same convention as QuizOverlay,
 * so it's confined to the workspace's content column (sidebar stays visible,
 * see learning-workspace.tsx's `contain: layout`) instead of covering the
 * whole viewport like a Radix Dialog portal would.
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
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !topic || !documentId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setChat([]);
    pathApi.getLesson(subjectId, documentId, topic)
      .then((data) => { if (!cancelled) setLesson(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được nội dung học."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (mode === "full") {
      // Past Q&A for this exact (document, topic) - backend reuses the SAME
      // conversation across every visit, so show its existing thread instead
      // of starting blank (see PathService.get_or_create_topic_conversation).
      pathApi.getTopicChatHistory(subjectId, documentId, topic)
        .then((history) => { if (!cancelled) setChat(history); })
        .catch(() => { /* best-effort: chat just starts empty this time */ });
    }
    return () => { cancelled = true; };
  }, [open, subjectId, documentId, topic, mode]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || !topic || !documentId || asking) return;
    setAsking(true);
    setChat((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    try {
      const { answer } = await pathApi.askAboutTopic(subjectId, documentId, topic, q);
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

  if (!open) return null;

  const displayExcerpts = lesson ? orderExcerptsForDisplay(lesson.excerpts) : [];

  return (
    <div className="fixed inset-0 z-50 flex h-full w-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{topic}</p>
          <p className="truncate text-xs text-muted-foreground">
            {mode === "full" ? "Xem lại kiến thức trước khi luyện tập." : "Kiến thức liên quan tới câu bạn vừa làm sai."}
          </p>
        </div>
        <Button variant="outline" size="icon" className="ml-auto size-8" onClick={onClose} aria-label="Đóng (Esc)">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 24 }}>
        {error ? <div role="alert" className="error-box"><p>{error}</p></div> : null}

        {loading ? (
          <p className="meta" style={{ marginTop: 12 }}>Đang tải…</p>
        ) : lesson ? (
          <div className="space-y-4 py-2">
            <MarkdownContent>{lesson.summary}</MarkdownContent>

            {displayExcerpts.length > 0 ? (
              <div>
                <p className="label" style={{ marginBottom: 8 }}>Trích đoạn gốc trong tài liệu</p>
                <div className="scroll-list">
                  {displayExcerpts.map((excerpt, index) => (
                    <Excerpt key={index} excerpt={excerpt} documentId={documentId as string} />
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
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>Đóng</Button>
        {mode === "full" ? (
          <Button onClick={() => void handleStartPractice()} disabled={starting || loading}>
            {starting ? "Đang tạo bài…" : "Luyện tập"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
