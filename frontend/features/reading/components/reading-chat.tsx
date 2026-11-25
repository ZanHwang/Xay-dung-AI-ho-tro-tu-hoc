"use client";

/**
 * Right-hand panel of the reading workspace: a single document-scoped AI chat
 * plus a "Ghi chú" (notes / summaries) tab.
 *
 * There is no separate "summarize" control - users just type "tóm tắt ...".
 * The backend detects that intent and routes to the summarization engine
 * (reads the PDF, not RAG) and returns `kind="summary"`; the answer renders
 * as a regular assistant message tagged `kind: "summary"`.
 *
 * The Q&A history is persisted in its own table (D2, NOT the Tutor system)
 * and reloaded when the panel mounts, so the dialogue survives refreshes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChatMessage } from "@/features/tutor/components/chat-message";
import type { ChatMessage as ChatMessageModel } from "@/features/tutor/types";
import type {
  ReadingAnnotation,
  ReadingChatHistoryMessage,
  ReadingSource,
} from "@/features/reading/services/reading-api";
import {
  askReadingQuestion,
  listReadingChatHistory,
  appendReadingChatHistory,
  createAnnotation,
  deleteAnnotation,
} from "@/features/reading/services/reading-api";

export type ReadingMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ReadingSource[];
  figure_note?: string;
  kind?: "summary";
  label?: string;
  timestamp: string;
};

type ReadingChatProps = {
  documentId: string;
  documentName: string;
  ready: boolean;
  currentPage: number;
  onJumpToPage: (page: number) => void;
  annotations: ReadingAnnotation[];
  onAnnotationsChanged: () => void;
  messages: ReadingMessage[];
  onMessages: (updater: (prev: ReadingMessage[]) => ReadingMessage[]) => void;
  busy: boolean;
  onBusy: (b: boolean) => void;
};

function nowStamp(): string {
  return new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChatModel(m: ReadingMessage): ChatMessageModel {
  return {
    id: m.id,
    role: m.role,
    content:
      m.kind === "summary"
        ? `**${m.label ?? "Tóm tắt"}**\n\n${m.content}`
        : m.content,
    timestamp: m.timestamp,
    sources: m.sources,
  };
}

export function ReadingChat({
  documentId,
  documentName,
  ready,
  currentPage,
  onJumpToPage,
  annotations,
  onAnnotationsChanged,
  messages,
  onMessages,
  busy,
  onBusy,
}: ReadingChatProps) {
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [draft, setDraft] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sortedAnnotations = useMemo(
    () =>
      [...annotations].sort((a, b) => {
        const ap = a.page ?? -1;
        const bp = b.page ?? -1;
        if (ap !== bp) return ap - bp;
        return a.created_at.localeCompare(b.created_at);
      }),
    [annotations],
  );

  // ---- Load the persisted Q&A history once per document (D2) -------------
  // Loaded rows are PREPENDED to whatever is already in the panel, so a
  // message the user sent before the fetch resolved is never dropped.
  useEffect(() => {
    let cancelled = false;
    listReadingChatHistory(documentId)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        const loaded: ReadingMessage[] = rows.map((r: ReadingChatHistoryMessage) => ({
          id: r.id,
          role: r.role as "user" | "assistant",
          content: r.content,
          sources: r.sources ?? undefined,
          figure_note: r.figure_note ?? undefined,
          kind: r.kind === "summary" ? "summary" : undefined,
          label: r.label ?? undefined,
          timestamp: new Date(r.created_at).toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        }));
        onMessages((prev) => {
          if (prev.length === 0) return loaded;
          const known = new Set(prev.map((m) => m.id));
          return [...loaded.filter((m) => !known.has(m.id)), ...prev];
        });
      })
      .catch(() => {
        /* transient - start with an empty panel */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function ask() {
    const question = draft.trim();
    if (!question || busy || !ready) return;
    setDraft("");
    setAskError(null);
    onMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: question, timestamp: nowStamp() },
    ]);
    onBusy(true);
    try {
      const result = await askReadingQuestion(documentId, question, [currentPage]);
      const isSummary = result.kind === "summary";
      const label = isSummary
        ? `Tóm tắt trang ${(result.pages ?? [])[0]}–${(result.pages ?? [])[1] ?? ""}`
        : undefined;
      const content = result.figure_note
        ? `**PHÂN TÍCH HÌNH:** ${result.figure_note}\n\n${result.answer}`
        : result.answer;
      onMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content,
          sources: result.sources,
          figure_note: result.figure_note ?? undefined,
          kind: isSummary ? "summary" : undefined,
          label,
          timestamp: nowStamp(),
        },
      ]);
      // Persist the exchange (D2). A summary answer is already saved to the
      // notes panel by the backend; refresh it.
      appendReadingChatHistory(documentId, {
        user_message: question,
        assistant_message: result.answer,
        sources: result.sources ?? null,
        figure_note: result.figure_note ?? null,
        kind: isSummary ? "summary" : null,
        label: label ?? null,
      }).catch(() => {});
      if (isSummary) onAnnotationsChanged();
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Không trả lời được. Thử lại.");
    } finally {
      onBusy(false);
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }

  async function saveNote() {
    const text = noteText.trim();
    if (!text || !ready || savingNote) return;
    setSavingNote(true);
    try {
      // Notes and highlights were merged into a single "Ghi chú" type -
      // the two had no functional difference in the data layer.
      await createAnnotation(documentId, {
        page: currentPage,
        text,
        type: "note",
      });
      setNoteText("");
      onAnnotationsChanged();
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Lưu ghi chú thất bại.");
    } finally {
      setSavingNote(false);
    }
  }

  async function removeNote(id: string) {
    try {
      await deleteAnnotation(documentId, id);
      onAnnotationsChanged();
    } catch {
      /* ignore; row stays until refetched */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "chat" | "notes")}>
        <TabsList className="w-full">
          <TabsTrigger value="chat">Hỏi AI</TabsTrigger>
          <TabsTrigger value="notes">Ghi chú ({annotations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Hỏi bất kỳ điều gì về{" "}
                <span className="font-medium">{documentName}</span> — kể cả
                yêu cầu tóm tắt cả file hay tóm tắt một khoảng trang. Câu
                trả lời kèm trích dẫn trang — bấm vào{" "}
                <span className="font-medium">(trang N)</span> để nhảy tới
                đúng trang.
              </p>
            ) : (
              messages.map((m) => (
                <ChatMessage key={m.id} message={toChatModel(m)} onJumpToPage={onJumpToPage} />
              ))
            )}
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang trả lời…
              </div>
            ) : null}
            {askError ? (
              <p role="alert" className="text-xs text-destructive">
                {askError}
              </p>
            ) : null}
          </div>

          {/* Input - the single box: ask questions OR summarize */}
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
                disabled={!ready}
                placeholder={
                  ready
                    ? "Hỏi về tài liệu này… (vd: “tóm tắt cả file”, “trang 5 nói gì?”)"
                    : "Tài liệu đang xử lý…"
                }
                rows={2}
                className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={ask}
                disabled={!ready || busy || !draft.trim()}
                className="grid size-10 shrink-0 place-items-center rounded-lg disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                aria-label="Gửi"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {sortedAnnotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có ghi chú nào. Thêm ghi chú hoặc tóm tắt (qua ô Hỏi AI) ngay bên dưới.
              </p>
            ) : (
              sortedAnnotations.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span
                      className={a.type === "summary" ? "pill pill-violet" : "pill pill-green"}
                      style={{ height: 20 }}
                    >
                      {a.type === "summary" ? "Tóm tắt" : "Ghi chú"}
                    </span>
                    {a.page != null ? (
                      <button
                        type="button"
                        onClick={() => onJumpToPage(a.page!)}
                        className="jump-link"
                        style={{ fontSize: 12 }}
                      >
                        Trang {a.page}
                      </button>
                    ) : (
                      <span className="meta" style={{ fontSize: 12 }}>Không rõ trang</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeNote(a.id)}
                      className="ml-auto flex items-center gap-1 text-xs"
                      style={{ color: "var(--error)", background: "none", border: 0, cursor: "pointer" }}
                    >
                      <Trash2 className="size-3.5" /> Xóa
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{a.text}</p>
                </div>
              ))
            )}
          </div>

          {/* Add note form - single "Ghi chú" type (merged with "Đánh dấu") */}
          <div className="border-t border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="note-text">
                Ghi chú
              </label>
              <span className="ml-auto text-xs text-muted-foreground">
                Lưu tại trang {currentPage}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                id="note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                disabled={!ready}
                placeholder="Ghi chú của bạn về trang này…"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={saveNote}
                disabled={!ready || savingNote || !noteText.trim()}
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                style={{ background: "var(--accent)" }}
              >
                {savingNote ? "Lưu…" : "Lưu"}
              </button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
