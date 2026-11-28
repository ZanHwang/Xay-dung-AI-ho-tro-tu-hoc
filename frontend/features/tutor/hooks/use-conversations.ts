"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Subject } from "@/features/subjects/types";
import { createConversationStore } from "../services/conversation-store";
import { chatApi, getDemoConversations } from "../services/chat-api";
import { classifyQuestion, titleFromQuestion } from "../services/classify-question";
import { removeChatImages } from "../services/chat-images";
import { saveChatAttachments } from "../services/chat-attachments";
import type { ChatImage, ChatMessage, Conversation, MessageSource } from "../types";

/**
 * @param userId Scopes the localStorage key so chat history doesn't leak
 * between accounts sharing the same browser (see createConversationStore).
 */
/** Conversations fetched from the server at a time. */
const PAGE = 50;

export function useConversations(userId: string) {
  const store = useMemo(() => createConversationStore(() => window.localStorage, userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const inFlight = useRef(new Set<string>());
  const submittedDraft = useRef<number | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // How many conversations the server has, and how many of them (newest
  // first) have been fetched: "Tải thêm" asks for the next page.
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoaded, setServerLoaded] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Check if we should use API mode
  const isDemoMode = typeof window !== "undefined" &&
    !process.env.NEXT_PUBLIC_API_BASE_URL &&
    !sessionStorage.getItem("jarvis.auth.token");

  useEffect(() => {
    store.hydrate();

    // Load conversations from API if in API mode
    if (!isDemoMode) {
      loadConversations();
    }
  }, [store, isDemoMode]);

  async function loadConversations() {
    try {
      const result = await chatApi.listConversations({ limit: PAGE });
      // Upsert each server conversation. A server row only carries metadata
      // + message_count, so it must NOT wipe the local messages that the
      // user already has in this tab; it only fills in what's missing.
      result.conversations.forEach((conv) => store.mergeConversation(conv));
      setServerTotal(result.total);
      setServerLoaded((count) => Math.max(count, result.conversations.length));
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }

  /** The next page of older conversations from the server. */
  async function loadMore() {
    if (isDemoMode || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await chatApi.listConversations({ limit: PAGE, offset: serverLoaded });
      result.conversations.forEach((conv) => store.mergeConversation(conv));
      setServerTotal(result.total);
      setServerLoaded((count) => count + result.conversations.length);
    } catch (err) {
      console.error("Failed to load more conversations:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  /** Conversations on the server whose title contains `query`, added to the
   * list so older ones not fetched yet can be found too. Best-effort. */
  async function search(query: string) {
    if (isDemoMode || !query.trim()) return;
    try {
      const result = await chatApi.listConversations({ q: query.trim(), limit: PAGE });
      result.conversations.forEach((conv) => store.mergeConversation(conv));
    } catch (err) {
      console.error("Failed to search conversations:", err);
    }
  }

  // Load a server-side conversation's messages into the local store (used when
  // the user opens a conversation pulled from the list without its message
  // bodies, or one the server has more messages for - continued elsewhere).
  // No-op when the local copy is already complete.
  async function loadMessages(id: string) {
    if (isDemoMode) return;
    const local = store.getSnapshot().conversations.find((c) => c.id === id);
    if (local && local.messages.length > 0 && local.messages.length >= (local.messageCount ?? 0)) return;
    try {
      // The endpoint returns messages oldest-first, capped at 100. For long
      // conversations the interesting part is the LAST 100, so when the total
      // is bigger, re-fetch with an offset to window onto the tail.
      const page = await chatApi.getMessages(id, { limit: 100 });
      const messages =
        page.total > page.messages.length
          ? (await chatApi.getMessages(id, { limit: 100, offset: page.total - 100 })).messages
          : page.messages;
      // Attachments/sources live only in the local copy - keep the local
      // version of any message the server also has (same role + content).
      const localByKey = new Map<string, ChatMessage[]>();
      for (const message of local?.messages ?? []) {
        const key = `${message.role}\u0000${message.content}`;
        localByKey.set(key, [...(localByKey.get(key) ?? []), message]);
      }
      store.setMessages(id, messages.map((message) => localByKey.get(`${message.role}\u0000${message.content}`)?.shift() ?? message));
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }

  async function send(id: string | null, text: string, subjects: Subject[], files: File[] = []) {
    const question = text.trim() || (files.length ? "Hỏi về tệp đính kèm" : "");
    const origin = store.getSnapshot();
    const key = id ?? `draft:${origin.draftRevision}`;
    if (!origin.ready || !question || inFlight.current.has(key)) return false;
    if (id === null) {
      if (submittedDraft.current === origin.draftRevision) return false;
    }
    inFlight.current.add(key);
    setPending([...inFlight.current]);
    setErrors((current) => ({ ...current, [key]: "" }));
    let images: ChatImage[] = [];
    let accepted = false;
    try {
      images = await saveChatAttachments(files);
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: question,
        images: images.filter((file) => file.type.startsWith("image/")),
        documents: images.filter((file) => !file.type.startsWith("image/")),
        timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      };
      if (id === null) {
        const classification = classifyQuestion(question, subjects, origin.draftSubjectId);
        const current = store.getSnapshot();
        const activate = current.activeId === null && current.draftRevision === origin.draftRevision;
        id = store.create(titleFromQuestion(question), classification.subjectId, classification.classification, message, activate);
        submittedDraft.current = origin.draftRevision;
      } else {
        if (!store.getSnapshot().conversations.some((item) => item.id === id)) throw new Error("Cuộc hội thoại đã bị xóa.");
        store.append(id, message);
      }
      const conversation = store.getSnapshot().conversations.find((item) => item.id === id);
      if (!conversation || !id) throw new Error("Không thể gửi tin nhắn.");
      accepted = true;
      inFlight.current.add(id); setPending([...inFlight.current]);

      let reply: string;
      let sourcesFromApi: MessageSource[] = [];
      // null = unknown (demo/mock replies); true/false = whether documents
      // were part of the answer pipeline (RAG vs plain chat knowledge).
      let groundedFromApi: boolean | null = null;

      if (isDemoMode) {
        // Use mock reply in demo mode
        const { generateTutorReply } = await import("../services/tutor.service");
        reply = await generateTutorReply({
          conversationId: id,
          subjectId: conversation.subjectId,
          subjectName: subjects.find((subject) => subject.id === conversation.subjectId)?.name,
          messages: conversation.messages,
        });
      } else {
        // Use real API
        try {
          // Documents that may ground the answer:
          //  - files attached to THIS message (uploaded now, conversation-only),
          //  - the ready documents of the conversation's subject (if any).
          // When the union is non-empty the backend runs retrieval and treats
          // the chunks as reference material: related questions are answered
          // from them (with sources), unrelated ones fall back to general
          // knowledge - it never blocks a question.
          let mode: "chat" | "rag" = "chat";
          const documentIds = new Set<string>();

          const { uploadAndIndexDocument, documentApi } = await import(
            "@/features/subjects/services/document-api"
          );

          const documentFiles = files.filter((file) => !file.type.startsWith("image/"));
          for (const file of documentFiles) {
            const indexedId = await uploadAndIndexDocument(file);
            if (indexedId) documentIds.add(indexedId);
          }

          if (conversation.subjectId) {
            const docs = await documentApi.list(conversation.subjectId).catch(() => []);
            for (const doc of docs.filter((d) => d.status === "ready")) documentIds.add(doc.id);
          }

          if (documentIds.size > 0) mode = "rag";

          const response = await chatApi.sendChat({
            conversation_id: id,
            content: question,
            subject_id: conversation.subjectId ?? undefined,
            mode,
            ...(documentIds.size > 0 ? { document_ids: [...documentIds] } : {}),
            ...(images.length > 0 ? { attachment_ids: images.map((file) => file.id) } : {}),
          });
          reply = response.message.content;
          // Track whether this reply was grounded in retrieved documents so the
          // UI can show a "Nguồn" line (RAG) vs "không dùng tài liệu" (chat).
          // The backend returns citations whenever it retrieved anything; the
          // chosen `mode` tells us which pipeline ran.
          sourcesFromApi = (response.sources as MessageSource[] | undefined) ?? [];
          groundedFromApi = documentIds.size > 0 || sourcesFromApi.length > 0;

          // The local store names a new conversation with a client-side UUID;
          // the backend assigns the real id on first use. Whenever the ids
          // differ, remap the local conversation to the backend id so every
          // later turn targets the same server-side record - that is what
          // gives the AI its history between turns.
          if (response.conversation_id && response.conversation_id !== id) {
            store.updateConversationId(id, response.conversation_id);
            id = response.conversation_id;
          }
        } catch (apiError) {
          console.error("Chat API error:", apiError);
          // Fallback to mock if API fails
          const { generateTutorReply } = await import("../services/tutor.service");
          reply = await generateTutorReply({
            conversationId: id,
            subjectId: conversation.subjectId,
            subjectName: subjects.find((subject) => subject.id === conversation.subjectId)?.name,
            messages: conversation.messages,
          });
        }
      }

      store.append(id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        sources: sourcesFromApi.length ? sourcesFromApi : undefined,
        grounded: groundedFromApi ?? undefined,
        timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      });
      return { conversationId: id, reply };
    } catch (error) {
      if (!accepted) await removeChatImages(images).catch(() => undefined);
      setErrors((current) => ({ ...current, [accepted && id ? id : key]: error instanceof Error ? error.message : "Không thể gửi câu hỏi. Hãy thử lại." }));
      return accepted && id ? { conversationId: id, reply: null } : false;
    } finally {
      inFlight.current.delete(key);
      if (id) inFlight.current.delete(id);
      setPending([...inFlight.current]);
    }
  }

  async function remove(id: string) {
    store.remove(id);

    // Deleting the conversation on the server also removes its attachments.
    if (!isDemoMode) {
      try {
        await chatApi.deleteConversation(id);
      } catch (err) {
        console.error("Failed to delete conversation from API:", err);
      }
    }
  }

  return {
    ...state, store, pending, errors, send, remove, loadMessages,
    loadMore, search, loadingMore,
    hasMore: !isDemoMode && serverLoaded < serverTotal,
    // Re-fetch the conversation list from the backend - `loadConversations`
    // otherwise only ever runs once, on this hook's own mount (which, since
    // it's instantiated once at LearningWorkspace and never remounts, means
    // a conversation created elsewhere on the backend afterwards - e.g. Lộ
    // trình "Học"'s own ask endpoint - would never show up without this.
    // Call when the Tutor tab becomes active (see learning-workspace.tsx).
    refresh: isDemoMode ? () => {} : loadConversations,
  };
}

export type ConversationsController = ReturnType<typeof useConversations>;
