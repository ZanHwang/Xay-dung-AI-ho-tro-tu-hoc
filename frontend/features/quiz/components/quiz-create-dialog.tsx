"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Subject } from "@/features/subjects/types";
import { documentApi } from "@/features/subjects/services/document-api";
import type { QuizController } from "../hooks/use-quizzes";
import { quizApi } from "../services/quiz-api";

const MAX_QUESTIONS = 50; // backend cap, see app/schemas/quiz.py::QuizCreateNext
const ALL_KNOWLEDGE = "__all__";
const CUSTOM_TOPIC = "__custom__";

type TopicGroup = { documentId: string; documentName: string; topics: string[] };

/**
 * Creates a quiz for one subject, in place (no navigation) — same shape as
 * CreateSubjectDialog. Topic chips are grouped by document (each document's
 * own AI-detected topics - see Document.topics_json / ensure_document_topics).
 * With many documents, showing every group's chips at once gets cluttered,
 * so a document must be picked first (dropdown) before its chips appear -
 * only one document's chips are ever on screen at a time. Fetched fresh
 * (documentApi.list) each time the dialog opens, since a document can finish
 * processing (and get topics cached) while the user stays on the page.
 * "Chủ đề khác…" covers subjects/documents with no detected topics by
 * letting the user type one (not tied to any document). Any custom topic
 * that AI successfully produces at least one question for becomes a quick
 * pick next time (quizApi.getKnownTopics) - separate from Lộ trình, which
 * only ever uses per-document topics. The SAME text box doubles as a live
 * filter over those quick picks (no separate filter input) - still creates
 * a brand new topic on "Tạo Quiz" if nothing is clicked and it's genuinely
 * new/relevant to the subject.
 */
export function QuizCreateDialog({ subject, quizzes, onCreated }: {
  subject: Subject;
  quizzes: QuizController;
  onCreated: (quizId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(5);
  const [scope, setScope] = useState<string>(ALL_KNOWLEDGE);
  // Set alongside `scope` when a chip from one document's own group is
  // picked, so handleCreate knows to tag the quiz to that document - null
  // for "Tổng hợp" and "Chủ đề khác" (not tied to any one document).
  const [scopeDocumentId, setScopeDocumentId] = useState<string | null>(null);
  const [customTopic, setCustomTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Set instead of closing the dialog when the AI (shared bank + fresh
  // generation) couldn't reach the requested count - the quiz already exists
  // at this point, so this is a heads-up + explicit "proceed anyway" step,
  // not a retry prompt.
  const [shortfall, setShortfall] = useState<{ id: string; actual: number; requested: number } | null>(null);
  const [groups, setGroups] = useState<TopicGroup[]>([]);
  // Custom topics ("Chủ đề khác…") proven valid before for this subject
  // (shared bank, see quizApi.getKnownTopics) - not tied to any document,
  // so clicking one just sets `scope` directly like a document chip does,
  // with scopeDocumentId left null.
  const [knownTopics, setKnownTopics] = useState<string[]>([]);
  // Which document's own topic chips are currently shown below - purely a
  // "what to display" picker (not the final scope). Keeps many documents
  // from all dumping their chips on screen at once; a chip is still only
  // chosen (via setScope/setScopeDocumentId) when clicked.
  const [pickedDocumentId, setPickedDocumentId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    documentApi.list(subject.id).then((docs) => {
      if (cancelled) return;
      setGroups(
        docs
          .filter((d) => d.status === "ready" && d.topics.length > 0)
          .map((d) => ({ documentId: d.id, documentName: d.filename, topics: d.topics }))
      );
    }).catch(() => {
      // Best-effort: keep showing whatever groups we already had.
    });
    quizApi.getKnownTopics(subject.id).then((topics) => {
      if (!cancelled) setKnownTopics(topics);
    }).catch(() => {
      // Best-effort: keep showing whatever we already had.
    });
    return () => { cancelled = true; };
  }, [open, subject.id]);

  function reset() {
    setCount(5);
    setScope(ALL_KNOWLEDGE);
    setScopeDocumentId(null);
    setPickedDocumentId("");
    setCustomTopic("");
    setError("");
    setShortfall(null);
  }

  const pickedGroup = groups.find((g) => g.documentId === pickedDocumentId) ?? null;
  // "Chủ đề khác" stays open after one of its saved topics is picked (the only
  // way `scope` names a topic without a document), so the choice stays visible.
  const customOpen = scope !== ALL_KNOWLEDGE && scopeDocumentId === null;
  const filteredKnownTopics = customTopic.trim()
    ? knownTopics.filter((name) => name.toLowerCase().includes(customTopic.trim().toLowerCase()))
    : knownTopics;

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      const allKnowledge = scope === ALL_KNOWLEDGE;
      const topic = allKnowledge ? null : scope === CUSTOM_TOPIC ? (customTopic.trim() || null) : scope;
      const quiz = await quizApi.createNext({
        subject_id: subject.id,
        topic,
        all_knowledge: allKnowledge,
        num_questions: count,
        difficulty: "medium",
        document_id: allKnowledge || scope === CUSTOM_TOPIC ? null : scopeDocumentId,
      });
      if (!quiz.questions.length) throw new Error("AI chưa tạo được câu hỏi. Hãy thử lại hoặc kiểm tra nội dung tài liệu.");
      const id = quizzes.store.create({
        subjectId: subject.id, title: quiz.title, difficulty: quiz.difficulty,
        source: "shared", conversationId: null, questions: quiz.questions, backendId: quiz.backendId,
      });
      if (quiz.questions.length < count) {
        setShortfall({ id, actual: quiz.questions.length, requested: count });
      } else {
        setOpen(false);
        reset();
        onCreated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo Quiz.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!creating) { setOpen(next); if (!next) reset(); } }}>
      <DialogTrigger asChild>
        <Button disabled={!quizzes.ready}>Tạo Quiz</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo Quiz cho {subject.name}</DialogTitle>
          <DialogDescription>Chọn phạm vi và số câu, AI sẽ tạo bài ngay.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <label className="field">
            Số câu
            <input
              type="number"
              className="input"
              min={1}
              max={MAX_QUESTIONS}
              value={count}
              disabled={creating}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCount(Number.isFinite(next) ? next : 1);
              }}
              onBlur={() => setCount((current) => Math.min(MAX_QUESTIONS, Math.max(1, Math.round(current) || 1)))}
            />
            <span className="meta">Tối đa {MAX_QUESTIONS} câu mỗi lần.</span>
          </label>

          <div>
            <p className="label" style={{ marginBottom: 8 }}>Phạm vi</p>
            <div className="choices">
              <button
                type="button"
                className="choice"
                disabled={creating}
                aria-pressed={scope === ALL_KNOWLEDGE}
                onClick={() => { setScope(ALL_KNOWLEDGE); setScopeDocumentId(null); setPickedDocumentId(""); }}
              >
                Tổng hợp
              </button>
              <button
                type="button"
                className="choice"
                disabled={creating}
                aria-pressed={customOpen}
                onClick={() => { setScope(CUSTOM_TOPIC); setScopeDocumentId(null); setPickedDocumentId(""); }}
              >
                Chủ đề khác…
              </button>
            </div>

            {customOpen ? (
              <>
                <input
                  type="text"
                  className="input"
                  style={{ marginTop: 8 }}
                  value={customTopic}
                  disabled={creating}
                  onChange={(event) => { setCustomTopic(event.target.value); setScope(CUSTOM_TOPIC); }}
                  placeholder="Ví dụ: Entropy, Hồi quy tuyến tính, Tokenization…"
                />
                {knownTopics.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    <p className="meta">
                      Chủ đề đã tạo được trước đây — bấm để chọn, hoặc cứ gõ tiếp ở trên nếu đây là chủ đề thực sự mới.
                    </p>
                    <div className="scroll-chips choices" style={{ marginTop: 4, padding: 2 }}>
                      {filteredKnownTopics.length === 0 ? (
                        <p className="meta">Không có chủ đề nào khớp.</p>
                      ) : filteredKnownTopics.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="choice"
                          disabled={creating}
                          aria-pressed={scope === name && scopeDocumentId === null}
                          onClick={() => { setScope(name); setScopeDocumentId(null); setPickedDocumentId(""); }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {groups.length === 0 ? (
              <p className="meta" style={{ marginTop: 8 }}>
                Môn này chưa có chủ đề gợi ý theo tài liệu — dùng “Chủ đề khác…” để gõ tay, hoặc để trống (Tổng hợp).
              </p>
            ) : (
              <>
                <label className="field" style={{ marginTop: 12 }}>
                  Hoặc chọn theo tài liệu
                  <select
                    className="input"
                    disabled={creating}
                    value={pickedDocumentId}
                    onChange={(event) => setPickedDocumentId(event.target.value)}
                  >
                    <option value="">— Chọn tài liệu —</option>
                    {groups.map((group) => (
                      <option key={group.documentId} value={group.documentId}>{group.documentName}</option>
                    ))}
                  </select>
                </label>

                {pickedGroup ? (
                  <div className="scroll-chips choices" style={{ marginTop: 8, padding: 2 }}>
                    {pickedGroup.topics.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="choice"
                        disabled={creating}
                        aria-pressed={scope === name && scopeDocumentId === pickedGroup.documentId}
                        onClick={() => { setScope(name); setScopeDocumentId(pickedGroup.documentId); }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {error ? (
            <div role="alert" className="error-box"><p>{error}</p></div>
          ) : null}

          {shortfall ? (
            <div className="banner">
              <p>
                AI chỉ tạo được <b>{shortfall.actual}/{shortfall.requested}</b> câu phù hợp với phạm vi này — quiz đã được tạo với số câu đó.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {shortfall ? (
            <>
              <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Để sau</Button>
              <Button onClick={() => { const id = shortfall.id; setOpen(false); reset(); onCreated(id); }}>
                Vào làm bài
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={creating}>Hủy</Button>
              <Button onClick={() => void handleCreate()} disabled={creating || !quizzes.ready}>
                {creating ? "Đang tạo câu hỏi…" : "Tạo Quiz"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
