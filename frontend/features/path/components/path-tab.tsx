"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import { QuizOverlay } from "@/features/quiz/components/quiz-overlay";
import { pathApi, type DocumentTopicGroup, type TopicProgress } from "../services/path-api";
import { TopicLearnDialog } from "./topic-learn-dialog";

const COMPLETION_THRESHOLD = 70;

function stateLabel(item: TopicProgress): string {
  if (item.state === "done") return `Đã xong · ${item.bestPercent}%`;
  if (item.state === "current") return "Đang học";
  return "Khóa";
}

/**
 * Lộ trình = 1 danh sách chủ đề riêng cho MỖI tài liệu đã xử lý xong
 * (Document.topics_json, sắp theo trình tự nên học - xem backend
 * LLMManager.order_topics), có bước Học (xem lại kiến thức) rồi Luyện tập
 * (quiz tự tạo). Mở khóa CHẶN THẬT nhưng CHỈ trong phạm vi 1 tài liệu - tài
 * liệu khác không bị ảnh hưởng (xem backend PathService.document_topic_groups:
 * mỗi nhóm tự tính current/locked riêng). "locked" không có gì để bấm, server
 * (PathService.start_practice) cũng từ chối nếu gọi thẳng API. Ai muốn ôn tự
 * do không theo thứ tự thì dùng "Tạo Quiz" ở tab Quiz, không bị ảnh hưởng bởi
 * lộ trình này.
 *
 * Phải CHỌN 1 TÀI LIỆU trước (dropdown) rồi mới hiện danh sách chủ đề của nó
 * - với nhiều tài liệu, hiện hết tất cả cùng lúc sẽ rất dài/rối mắt.
 */
export function PathTab({ subjectId, quizzes }: { subjectId: string; quizzes: QuizController }) {
  const [groups, setGroups] = useState<DocumentTopicGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<{ documentId: string; topic: string } | null>(null);
  const [practiceQuizId, setPracticeQuizId] = useState<string | null>(null);
  // Explicit user choice of which document's path to show. Empty string
  // means "no explicit choice yet" - activeGroup below then falls back to
  // the first group, computed at render time (no effect needed just to
  // apply a default). With many documents, showing every one's full topic
  // list at once gets cluttered - only the active one renders.
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const activeGroup = groups.find((g) => g.documentId === selectedDocumentId) ?? groups[0] ?? null;

  const load = useCallback(() => {
    pathApi.topics(subjectId)
      .then((rows) => { setGroups(rows); setError(""); })
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được lộ trình."))
      .finally(() => setLoading(false));
  }, [subjectId]);

  useEffect(() => {
    // No synchronous reset of loading/error here: the parent remounts this
    // component (key={`path-${subject.id}`}) on every subject switch, so the
    // useState initial values above already cover that case.
    load();
  }, [load]);

  return (
    <section aria-label="Lộ trình môn học">
      <div className="card">
        <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}>
          <Map className="size-4" style={{ color: "var(--accent-strong)" }} /> Lộ trình của môn
        </div>
        <p className="meta" style={{ marginTop: 8 }}>
          Mỗi tài liệu có lộ trình riêng — học từng chủ đề theo thứ tự rồi luyện tập đạt từ 70%
          để mở chủ đề tiếp theo TRONG CÙNG tài liệu đó.
        </p>

        {error ? (
          <div role="alert" className="error-box" style={{ marginTop: 12 }}><p>{error}</p></div>
        ) : null}

        {loading ? (
          <p className="meta" style={{ marginTop: 20 }}>Đang tải lộ trình…</p>
        ) : groups.length === 0 ? (
          <p className="meta" style={{ marginTop: 20 }}>
            Môn này chưa có chủ đề nào — tải tài liệu lên để AI tìm chủ đề và bắt đầu lộ trình.
          </p>
        ) : (
          <>
            <label className="field" style={{ marginTop: 20 }}>
              Tài liệu
              <select
                className="input"
                value={activeGroup?.documentId ?? ""}
                onChange={(event) => setSelectedDocumentId(event.target.value)}
              >
                {groups.map((group) => {
                  const done = group.topics.filter((t) => t.state === "done").length;
                  return (
                    <option key={group.documentId} value={group.documentId}>
                      {group.documentName} ({done}/{group.topics.length} xong)
                    </option>
                  );
                })}
              </select>
            </label>

            {activeGroup ? (
              <div className="scroll-list" style={{ marginTop: 12 }}>
                {activeGroup.topics.map((item, index) => {
                  const clickable = item.state !== "locked";
                  const needsReview = item.state === "done" && item.recentPercent !== null && item.recentPercent < COMPLETION_THRESHOLD;
                  return (
                    <div
                      key={item.topic}
                      className="list-row"
                      style={{
                        flexWrap: "wrap",
                        border: index === activeGroup.topics.length - 1 ? 0 : "1px solid var(--border)",
                        opacity: clickable ? 1 : 0.55,
                      }}
                    >
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-full"
                        style={{
                          background: item.state === "done" ? "var(--accent-soft)" : "var(--surface-2)",
                          color: item.state === "done" ? "var(--accent-strong)" : "var(--muted)",
                          fontWeight: 700,
                        }}
                      >
                        {item.state === "done" ? <Check className="size-4" /> : item.state === "locked" ? <Lock className="size-3.5" /> : index + 1}
                      </span>
                      <span className="grow">
                        <span className="title block">{item.topic}</span>
                        <span className="sub2 block">
                          {item.state === "locked" ? `Khóa — hoàn thành "${activeGroup.topics[index - 1]?.topic}" để mở` : stateLabel(item)}
                        </span>
                        {needsReview ? (
                          <span className="sub2 block" style={{ color: "var(--error)" }}>
                            ⚠ Lần gần nhất chỉ {item.recentPercent}% — nên ôn lại
                          </span>
                        ) : null}
                      </span>
                      {clickable ? (
                        <Button variant="outline" size="sm" onClick={() => setOpening({ documentId: activeGroup.documentId, topic: item.topic })}>
                          {item.state === "done" ? "Mở lại" : "Học"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>

      <TopicLearnDialog
        subjectId={subjectId}
        documentId={opening?.documentId ?? null}
        topic={opening?.topic ?? null}
        open={opening !== null}
        onClose={() => setOpening(null)}
        mode="full"
        quizzes={quizzes}
        onPracticeCreated={(localQuizId) => { setOpening(null); setPracticeQuizId(localQuizId); }}
      />

      <QuizOverlay
        quiz={quizzes.quizzes.find((item) => item.id === practiceQuizId) ?? null}
        quizzes={quizzes}
        autoStart
        onClose={() => { setPracticeQuizId(null); load(); }}
        onSwitchQuiz={() => {}}
      />
    </section>
  );
}
