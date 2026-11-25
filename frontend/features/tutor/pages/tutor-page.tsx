"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Plus, FileText, Pencil, Trash2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Subject } from "@/features/subjects/types";
import { ChatMessage } from "@/features/tutor/components/chat-message";
import type { ConversationsController } from "../hooks/use-conversations";
import { ChatImageView } from "../components/chat-image";
import { ChatMediaControls } from "../components/chat-media-controls";
import { validateChatAttachments } from "../services/chat-attachments";
import { formatFileSize } from "@/features/subjects/services/document.service";

type Props = { subjects: Subject[]; chats: ConversationsController; isVisible: boolean; onCreateQuiz: (subjectId: string | null, conversationId: string | null) => void };
type Editor = { id: string; title: string };

// v2 accent for the selected/active conversation rows.
const selectedRowStyle = {
  background: "var(--accent-soft)",
  color: "var(--accent-strong)",
};

export function TutorPage({ subjects, chats, onCreateQuiz, isVisible }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, File[]>>({});
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const active = chats.conversations.find((item) => item.id === chats.activeId);
  const pendingKey = active?.id ?? `draft:${chats.draftRevision}`;
  const pending = chats.pending.includes(pendingKey);
  const draftKey = active?.id ?? `new-${chats.draftRevision}`;
  const files = attachments[draftKey] ?? [];
  const input = drafts[draftKey] ?? "";
  const draftSubject = subjects.find((subject) => subject.id === chats.draftSubjectId);
  const subjectName = (id: string | null) => id === null ? "Hỏi đáp chung"
    : subjects.find((subject) => subject.id === id)?.name ?? "Môn học không còn tồn tại";
  const conversations = [...chats.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Open a conversation: switch to it and lazily fetch its messages from the
  // server when the local list is empty. Only server-pulled conversations
  // (which carry a messageCount) need this; a locally created one already has
  // its own messages (or is brand new).
  function openConversation(id: string) {
    chats.store.select(id);
    const conversation = chats.conversations.find((item) => item.id === id);
    if (conversation && conversation.messages.length === 0 && conversation.messageCount !== undefined) {
      void chats.loadMessages(id);
    }
  }
  // The list view shows the real count even before a conversation's messages
  // are loaded locally: prefer the local list (live), else the server count.
  const displayCount = (conversation: (typeof chats.conversations)[number]) =>
    conversation.messages.length > 0 ? conversation.messages.length : (conversation.messageCount ?? 0);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [active?.id, active?.messages.length, pending]);

  async function send(text = input) {
    if (!chats.ready || pending || (!text.trim() && !files.length)) return;
    const result = await chats.send(active?.id ?? null, text, subjects, files);
    if (!result) return;
    setDrafts((current) => ({ ...current, [draftKey]: "" }));
    setAttachments((current) => ({ ...current, [draftKey]: [] }));
  }

  function addFiles(added: File[]) {
    try {
      validateChatAttachments([...files, ...added]);
      setAttachments((current) => ({ ...current, [draftKey]: [...files, ...added] }));
      setMediaErrors((current) => ({ ...current, [draftKey]: "" }));
    } catch (error) { setMediaErrors((current) => ({ ...current, [draftKey]: error instanceof Error ? error.message : "Không thể thêm tệp." })); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="view-head row-between">
        <div>
          <h2 className="mt-1">Trợ giảng cá nhân</h2>
          <p className="sub">
            {draftSubject && !active ? `Đặt câu hỏi về môn ${draftSubject.name}.` : "Hỏi ngay để bắt đầu. TuHoc sẽ đặt tên và nhận diện môn học từ câu hỏi đầu tiên."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!chats.ready} onClick={() => onCreateQuiz(active ? active.subjectId : chats.draftSubjectId, active?.id ?? null)}>
            <ClipboardCheck /> Tạo Quiz
          </Button>
          <Button disabled={!chats.ready} onClick={() => chats.store.startNew()}>
            <Plus /> Hội thoại mới
          </Button>
        </div>
      </div>

      {chats.storageError && (
        <div role="alert" className="banner" style={{ marginBottom: 16 }}>
          <b>Lưu trữ:</b> {chats.storageError}
        </div>
      )}

      <div className="chat-layout min-h-0 flex-1">
        <aside className="chat-side" aria-label="Lịch sử hội thoại">
          <p className="label">Cuộc hội thoại ({conversations.length})</p>
          {!chats.ready ? <p className="meta" style={{ marginTop: 12 }}>Đang tải lịch sử...</p> : conversations.length === 0 ? <p className="meta" style={{ marginTop: 12 }}>Chưa có cuộc hội thoại.</p> : null}
          <div style={{ marginTop: 12 }}>
            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                aria-current={active?.id === conversation.id ? "true" : undefined}
                onClick={() => openConversation(conversation.id)}
                className="conv-row"
                style={active?.id === conversation.id ? selectedRowStyle : undefined}
              >
                <span className="grow title">{conversation.title}</span>
                <span className="sub2 block">{displayCount(conversation)} tin nhắn{chats.pending.includes(conversation.id) ? " · Đang trả lời" : ""}</span>
              </button>
            ))}
          </div>
          <p className="meta" style={{ marginTop: 20 }}>
            Lịch sử được lưu trên trình duyệt này. Tài liệu và tiến độ thuộc môn học, độc lập với cuộc hội thoại.
          </p>
        </aside>

        <section className="min-w-0 chat-main" aria-label="Nội dung hội thoại">
          <div className="row-between shrink-0" style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                <Bot className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate">{active?.title ?? "Cuộc hội thoại mới"}</h3>
                <p className="meta" style={{ marginTop: 2 }}>
                  {active ? (active.subjectId ? `Môn học: ${subjectName(active.subjectId)}` : "Hỏi đáp chung") : (draftSubject ? `Môn học: ${draftSubject.name}` : "Tự nhận diện môn học từ câu hỏi đầu tiên")}
                </p>
              </div>
            </div>
            {active ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" aria-label="Đổi tên cuộc hội thoại" onClick={() => setEditor({ id: active.id, title: active.title })}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Xóa cuộc hội thoại" onClick={() => setDeleteId(active.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="chat-log" role="log" aria-label="Tin nhắn">
            {!active ? (
              <div className="empty" style={{ margin: "auto", maxWidth: 420 }}>
                <h3>{draftSubject ? `Bạn muốn hỏi gì về ${draftSubject.name}?` : "Hôm nay bạn muốn học gì?"}</h3>
                <p>Gửi câu hỏi để bắt đầu. Hội thoại chỉ được lưu sau khi bạn gửi tin nhắn đầu tiên.</p>
              </div>
            ) : null}
            {active?.messages.length === 0 && (active.messageCount ?? 0) > 0 && (
              <p className="meta" style={{ color: "var(--accent-strong)" }}>Đang tải lịch sử hội thoại...</p>
            )}
            {active?.messages.length === 0 && (active.messageCount ?? 0) === 0 && (
              <p className="sub">Bạn muốn tìm hiểu điều gì?</p>
            )}
            {active?.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
            {pending && <p role="status" className="meta" style={{ color: "var(--accent-strong)" }}>TuHoc đang suy nghĩ...</p>}
            {chats.errors[pendingKey] && <p role="alert" className="meta" style={{ color: "var(--error)" }}>{chats.errors[pendingKey]}</p>}
            {chats.errors.cleanup && <p role="alert" className="meta" style={{ color: "var(--error)" }}>{chats.errors.cleanup}</p>}
            <div ref={bottom} />
          </div>

          <div className="shrink-0" style={{ borderTop: "1px solid var(--border)", padding: 16 }}>
            <div className="chat-input-wrap">
            {files.length > 0 && (
              <div style={{ marginBottom: 12, maxHeight: 192, overflow: "auto", display: "flex", gap: 12 }}>
                {files.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="shrink-0">
                    {file.type.startsWith("image/") ? <ChatImageView file={file} /> : (
                      <div className="mini-row" style={{ maxWidth: 240 }}>
                        <FileText className="size-5 shrink-0" style={{ color: "var(--muted)" }} />
                        <div className="grow min-w-0">
                          <p className="title truncate">{file.name}</p>
                          <p className="meta">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                    )}
                    <Button size="sm" variant="ghost" disabled={pending} aria-label={`Bỏ tệp ${file.name}`}
                      onClick={() => setAttachments((current) => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}>
                      Bỏ tệp
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {mediaErrors[draftKey] && <p role="alert" className="meta" style={{ color: "var(--error)", marginBottom: 8 }}>{mediaErrors[draftKey]}</p>}
            {isVisible && (
              <ChatMediaControls
                key={draftKey}
                disabled={!chats.ready || pending}
                onFiles={addFiles}
                input={input}
                hasFiles={files.length > 0}
                onInput={(text) => setDrafts((current) => ({ ...current, [draftKey]: text }))}
                onSend={() => void send()}
                onVoice={(text) => setDrafts((current) => ({ ...current, [draftKey]: [current[draftKey]?.trim(), text].filter(Boolean).join(" ") }))}
              />
            )}
            <p className="meta" style={{ textAlign: "center", marginTop: 8 }}>
              Tài liệu đính kèm / môn học sẽ được AI tìm kiếm để trả lời · Shift + Enter để xuống dòng
            </p>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đổi tên cuộc hội thoại</DialogTitle>
            <DialogDescription>Đặt tên để dễ tìm lại nội dung học tập.</DialogDescription>
          </DialogHeader>
          {editor && (
            <form className="space-y-4" onSubmit={(event) => {
              event.preventDefault();
              if (!editor.title.trim()) return;
              chats.store.rename(editor.id, editor.title);
              setEditor(null);
            }}>
              <label className="field">
                Tên cuộc hội thoại
                <Input autoFocus maxLength={120} value={editor.title}
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  placeholder="Ví dụ: Ôn tập chương 1" className="input" />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditor(null)}>Hủy</Button>
                <Button type="submit" disabled={!editor.title.trim()}>Lưu tên</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xóa cuộc hội thoại?</DialogTitle>
            <DialogDescription>Toàn bộ tin nhắn của cuộc hội thoại này sẽ bị xóa. Môn học, tài liệu và tiến độ vẫn được giữ nguyên.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Hủy</Button>
            <Button variant="destructive" onClick={() => { if (deleteId) void chats.remove(deleteId); setDeleteId(null); }}>Xóa hội thoại</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
