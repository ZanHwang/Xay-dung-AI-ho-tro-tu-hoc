import { z } from "zod";
import type { ChatMessage, Conversation } from "../types";

export const CONVERSATIONS_STORAGE_KEY = "jarvis.conversations.v1";
const conversationSchema = z.object({
  classification: z.enum(["automatic", "manual", "uncertain", "general"]).optional(),
  id: z.string().min(1),
  subjectId: z.string().min(1).nullable(),
  title: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative().optional(),
  messages: z.array(z.object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: z.string(),
    documents: z.array(z.object({ id: z.string().min(1), name: z.string(), type: z.string(), size: z.number().int().positive().max(10 * 1024 * 1024) })).max(4).optional(),
    images: z.array(z.object({ id: z.string().min(1), name: z.string(), type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(10 * 1024 * 1024) })).max(4).optional(),
    sources: z.array(z.object({ document_id: z.string().optional(), document_name: z.string().optional(), page: z.union([z.string(), z.number()]).nullish(), chunk_id: z.string().optional(), content_preview: z.string().optional(), figure: z.string().optional() })).optional(),
    grounded: z.boolean().optional(),
  })).refine((messages) => new Set(messages.map((message) => message.id)).size === messages.length),
});
const savedSchema = z.object({
  conversations: z.array(conversationSchema).refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
  ),
  activeId: z.string().nullable(),
});

type Snapshot = {
  draftSubjectId: string | null;
  draftRevision: number;
  conversations: Conversation[];
  activeId: string | null;
  ready: boolean;
  storageError: string | null;
};
type StorageAccess = () => Pick<Storage, "getItem" | "setItem"> & { removeItem?: Storage["removeItem"] };

// Scoped by account (userId) since v2 — before that, every account on the
// same browser shared one unscoped key, leaking chat history between them.
// `userId` is optional only so existing tests (which don't care about
// per-account scoping) keep working against the bare key.
export function createConversationStore(getStorage: StorageAccess, userId?: string) {
  const key = userId ? `${CONVERSATIONS_STORAGE_KEY}:${userId}` : CONVERSATIONS_STORAGE_KEY;
  let state: Snapshot = { conversations: [], activeId: null, ready: false, storageError: null, draftRevision: 0, draftSubjectId: null };
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function save(next: Snapshot) {
    try {
      getStorage().setItem(key, JSON.stringify({
        conversations: next.conversations, activeId: next.activeId,
      }));
      publish({ ...next, storageError: null });
    } catch {
      publish({ ...next, storageError: "Không thể lưu lịch sử trên trình duyệt. Thay đổi hiện chỉ được giữ trong phiên này." });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    hydrate() {
      if (state.ready) return;
      try {
        const ownValue = getStorage().getItem(key);
        // One-time migration: claim data saved under the old unscoped key
        // before this account has any of its own, so the first login after
        // this change doesn't lose existing chat history — then remove the
        // old key right away so a DIFFERENT account can't also claim it.
        let value = ownValue;
        let migratedFrom: string | null = null;
        if (value === null && userId) {
          migratedFrom = getStorage().getItem(CONVERSATIONS_STORAGE_KEY);
          value = migratedFrom;
        }
        const saved = value === null ? { conversations: [], activeId: null } : savedSchema.parse(JSON.parse(value));
        if (migratedFrom !== null) {
          getStorage().setItem(key, migratedFrom);
          getStorage().removeItem?.(CONVERSATIONS_STORAGE_KEY);
        }
        publish({ ...state, ...saved, activeId: null, ready: true, storageError: null });
      } catch {
        publish({ ...state, ready: true, storageError: "Không thể đọc lịch sử đã lưu. Dữ liệu có thể bị lỗi hoặc trình duyệt đang chặn lưu trữ." });
      }
    },
    startNew(subjectId: string | null = null) {
      // A blank composer is not a persisted conversation.
      publish({ ...state, activeId: null, draftRevision: state.draftRevision + 1, draftSubjectId: subjectId });
    },
    setDraftSubject(subjectId: string | null) {
      // Switch the context of the in-progress draft WITHOUT clearing the
      // typed text / attachments (those are keyed by draftRevision, which
      // this deliberately does not bump).
      publish({ ...state, draftSubjectId: subjectId });
    },
    create(title: string, subjectId: string | null, classification?: Conversation["classification"], firstMessage?: ChatMessage, activate = true) {
      if (!state.ready || !title.trim()) return null;
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: crypto.randomUUID(), title: title.trim().slice(0, 120), subjectId,
        createdAt: now, updatedAt: now, classification, messages: firstMessage ? [firstMessage] : [],
      };
      save({ ...state, conversations: [conversation, ...state.conversations], activeId: activate ? conversation.id : state.activeId });
      return conversation.id;
    },
    select(id: string) {
      if (state.conversations.some((item) => item.id === id)) save({ ...state, activeId: id });
    },
    rename(id: string, title: string) {
      if (!title.trim()) return;
      save({ ...state, conversations: state.conversations.map((item) => item.id === id
        ? { ...item, title: title.trim().slice(0, 120) } : item) });
    },
    setSubject(id: string, subjectId: string | null) {
      save({ ...state, conversations: state.conversations.map((item) => item.id === id
        ? { ...item, subjectId, classification: "manual" } : item) });
    },
    remove(id: string) {
      const conversations = state.conversations.filter((item) => item.id !== id);
      const removedActive = state.activeId === id;
      save({ ...state, conversations, activeId: removedActive ? null : state.activeId,
        draftSubjectId: removedActive ? null : state.draftSubjectId,
        draftRevision: state.draftRevision + (removedActive ? 1 : 0) });
    },
    append(id: string, message: ChatMessage) {
      // A late response must never recreate a deleted conversation or enter another chat.
      if (!state.conversations.some((item) => item.id === id)) return;
      save({ ...state, conversations: state.conversations.map((item) => item.id === id
        ? { ...item, messages: [...item.messages, message], updatedAt: new Date().toISOString() } : item) });
    },
    updateConversationId(localId: string, backendId: string) {
      // A new conversation is created locally with a client-side UUID; the
      // backend assigns its own. Rename the local conversation to the backend
      // id so subsequent sends target the same server-side record instead of
      // creating duplicates.
      if (localId === backendId || !state.conversations.some((item) => item.id === localId)) return;
      save({ ...state,
        conversations: state.conversations.map((item) => (item.id === localId ? { ...item, id: backendId } : item)),
        activeId: state.activeId === localId ? backendId : state.activeId,
      });
    },
    setMessages(id: string, messages: ChatMessage[]) {
      // Replace the loaded message list of a conversation (fetched lazily
      // from the API when a conversation is opened). Clear messageCount so
      // the local list becomes the source of truth again.
      if (!state.conversations.some((item) => item.id === id)) return;
      save({ ...state,
        conversations: state.conversations.map((item) => item.id === id
          ? { ...item, messages, messageCount: undefined }
          : item),
      });
    },
    mergeConversation(conversation: Conversation) {
      // Upsert a conversation from the server list: create it when absent,
      // and when present keep the richer of the two (a local one may hold
      // messages the server list only carries a count of).
      if (!state.conversations.some((item) => item.id === conversation.id)) {
        save({ ...state, conversations: [conversation, ...state.conversations] });
        return;
      }
      const local = state.conversations.find((item) => item.id === conversation.id);
      if (!local || (local.messages.length === 0 && conversation.messages.length > 0)) {
        save({ ...state,
          conversations: state.conversations.map((item) => item.id === conversation.id
            ? { ...item, ...conversation }
            : item),
        });
      }
    },
  };
}
