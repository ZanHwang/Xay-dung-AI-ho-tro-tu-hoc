"use client";

import { useEffect, useRef, useState } from "react";
import { Ellipsis, Plus, FileText, Pencil, Trash2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { searchKey, type Subject } from "@/features/subjects/types";
import { ChatMessage } from "@/features/tutor/components/chat-message";
import type { ConversationsController } from "../hooks/use-conversations";
import { ChatImageView } from "../components/chat-image";
import { ChatMediaControls } from "../components/chat-media-controls";
import { validateChatAttachments } from "../services/chat-attachments";
import { formatFileSize } from "@/features/subjects/services/document.service";

type Props = { subjects: Subject[]; chats: ConversationsController; isVisible: boolean; onCreateQuiz: (subjectId: string | null, conversationId: string | null) => void };
type Editor = { id: string; title: string };

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
  const [query, setQuery] = useState("");
  const wanted = searchKey(query);
  const conversations = [...chats.conversations]
    .filter((conversation) => !wanted || searchKey(conversation.title).includes(wanted))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Older conversations not fetched yet: ask the server too, shortly after typing stops.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = window.setTimeout(() => void chats.search(query), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const coverClass = (id: string | null | undefined) => {
    const accent = subjects.find((subject) => subject.id === id)?.accent;
    return accent ? `cover-${accent}` : "";
  };
  const activeSubjectId = active ? active.subjectId : chats.draftSubjectId;

  function openConversation(id: string) {
    chats.store.select(id);
  }
  // Fetch the active conversation's messages whenever the server knows more
  // of them than this local copy holds: pulled from the list without bodies,
  // or continued elsewhere (another device / Lộ trình "Học"). setMessages
  // clears messageCount afterwards, so this doesn't loop.
  useEffect(() => {
    if (active && active.messages.length < (active.messageCount ?? 0)) void chats.loadMessages(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.messageCount, active?.messages.length]);
  const displayCount = (conversation: (typeof chats.conversations)[number]) =>
    Math.max(conversation.messages.length, conversation.messageCount ?? 0);

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
      <h1 className="sr-only">Hỏi AI</h1>

      {chats.storageError && (
        <div role="alert" className="banner" style={{ marginBottom: 16 }}>
          <b>Lưu trữ:</b> {chats.storageError}
        </div>
      )}

      <div className="chat-layout min-h-0 flex-1">
        <aside className="chat-side" aria-label="Lịch sử hội thoại">
          <button type="button" className="btn btn-accent" disabled={!chats.ready} onClick={() => chats.store.startNew()}>
            <Plus className="size-5" aria-hidden="true" /> Hội thoại mới
          </button>
          {chats.ready && chats.conversations.length > 0 ? (
            <input
              type="search"
              className="input list-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm hội thoại"
              aria-label="Tìm hội thoại theo tên"
            />
          ) : null}
          {!chats.ready ? <p className="meta">Đang tải lịch sử...</p>
            : conversations.length === 0 ? <p className="meta" role="status">{wanted ? "Không có cuộc hội thoại nào khớp." : "Chưa có cuộc hội thoại."}</p>
            : null}
          {conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              aria-current={active?.id === conversation.id ? "true" : undefined}
              onClick={() => openConversation(conversation.id)}
              className="conv-row"
            >
              <span className={`spine-dot ${coverClass(conversation.subjectId)}`} aria-hidden="true" />
              <span className="grow">
                <span className="title">{conversation.title}</span>
                <span className="sub2">
                  {displayCount(conversation)} tin nhắn{chats.pending.includes(conversation.id) ? ", đang trả lời" : ""}
                </span>
              </span>
            </button>
          ))}
          {chats.hasMore && !wanted ? (
            <button type="button" className="btn btn-outline btn-sm load-more" disabled={chats.loadingMore} onClick={() => void chats.loadMore()}>
              {chats.loadingMore ? "Đang tải…" : "Tải thêm hội thoại cũ"}
            </button>
          ) : null}
        </aside>

        <section className="min-w-0 chat-main" aria-label="Nội dung hội thoại">
          <div className="talk-head">
            <div>
              <h2 className="truncate">{active?.title ?? "Cuộc hội thoại mới"}</h2>
              {!active && !draftSubject ? <p className="meta">Tự nhận diện môn học từ câu hỏi đầu tiên</p> : null}
            </div>
            {activeSubjectId || active ? (
              <span className={`pill subject-pill ${coverClass(activeSubjectId)}`}>{subjectName(activeSubjectId ?? null)}</span>
            ) : null}
            <Button variant="outline" disabled={!chats.ready} onClick={() => onCreateQuiz(active ? active.subjectId : chats.draftSubjectId, active?.id ?? null)}>
              <ClipboardCheck /> Tạo Quiz
            </Button>
            {active ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="more" aria-label="Đổi tên hoặc xóa cuộc hội thoại">
                    <Ellipsis className="size-5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="menu-panel" align="end">
                  <DropdownMenuItem onSelect={() => setEditor({ id: active.id, title: active.title })}>
                    <Pencil /> Đổi tên cuộc hội thoại
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteId(active.id)}>
                    <Trash2 /> Xóa cuộc hội thoại
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
              AI tìm trong tài liệu của môn và tệp đính kèm để trả lời. Shift + Enter để xuống dòng.
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
