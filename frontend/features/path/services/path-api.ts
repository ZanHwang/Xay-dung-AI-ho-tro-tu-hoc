import { httpClient } from "@/services/http-client";
import { mapQuiz, mapQuizQuestion } from "@/features/quiz/services/quiz-api";
import type { Quiz } from "@/features/quiz/types";
import type { ApiQuizWithQuestions } from "@/features/quiz/types";

// =============================================================================
// Learning path (lộ trình) API client — grouped PER DOCUMENT: each READY
// document with topics of its own gets an independent ordered topic list and
// an independent done/current/locked gating (no document blocks another).
// Topics past the first not-done one in a document's OWN list are really
// locked: start() and lesson() below both go through the backend's own
// gating (see PathService.start_practice), not just a UI hide.
// =============================================================================

export interface TopicProgress {
  topic: string;
  state: "done" | "current" | "locked";
  bestPercent: number | null;
  recentPercent: number | null;
}

export interface DocumentTopicGroup {
  documentId: string;
  documentName: string;
  topics: TopicProgress[];
}

interface ApiTopicProgress {
  topic: string;
  state: string;
  best_percent: number | null;
  recent_percent: number | null;
}

interface ApiDocumentTopicGroup {
  document_id: string;
  document_name: string;
  topics: ApiTopicProgress[];
}

export interface TopicExcerpt {
  documentName: string;
  page: string | null;
  content: string;
}

export interface TopicLesson {
  topic: string;
  summary: string;
  excerpts: TopicExcerpt[];
}

interface ApiTopicLesson {
  topic: string;
  summary: string;
  excerpts: Array<{ document_name: string; page: string | null; content: string }>;
}

export interface TopicChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const pathApi = {
  /** One group per document, each with its own ordered topic list. */
  async topics(subjectId: string): Promise<DocumentTopicGroup[]> {
    const rows = await httpClient.get<ApiDocumentTopicGroup[]>(`/subjects/${subjectId}/path/topics`);
    return rows.map((g) => ({
      documentId: g.document_id,
      documentName: g.document_name,
      topics: g.topics.map((r) => ({
        topic: r.topic,
        state: r.state as TopicProgress["state"],
        bestPercent: r.best_percent,
        recentPercent: r.recent_percent,
      })),
    }));
  },

  /** Cached "Học" content for one (document, topic) pair. */
  async getLesson(subjectId: string, documentId: string, topic: string): Promise<TopicLesson> {
    const api = await httpClient.get<ApiTopicLesson>(
      `/subjects/${subjectId}/path/documents/${documentId}/topics/${encodeURIComponent(topic)}/lesson`
    );
    return {
      topic: api.topic,
      summary: api.summary,
      excerpts: api.excerpts.map((e) => ({ documentName: e.document_name, page: e.page, content: e.content })),
    };
  },

  /**
   * Create the auto-generated "Luyện tập" quiz for this (document, topic)
   * entry. 403s (as an ApiError, see http-client.ts) if the topic is locked
   * server-side.
   */
  async startPractice(subjectId: string, documentId: string, topic: string): Promise<Quiz> {
    const api = await httpClient.post<ApiQuizWithQuestions>(
      `/subjects/${subjectId}/path/documents/${documentId}/topics/${encodeURIComponent(topic)}/practice`, {}
    );
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },

  /**
   * Ask the AI a free-form question about `topic`, scoped to just that one
   * document, reusing the existing /conversations/chat endpoint (RAG) - no
   * dedicated backend endpoint for this. `conversationId` should be null on
   * the first question of a session and then the id this returns for every
   * follow-up, so the AI keeps the thread's context.
   */
  async askAboutTopic(
    subjectId: string,
    documentId: string,
    topic: string,
    question: string,
    conversationId: string | null,
  ): Promise<{ answer: string; conversationId: string }> {
    const response = await httpClient.post<{
      message: { content: string; conversation_id: string };
    }>("/conversations/chat", {
      conversation_id: conversationId,
      content: `[Đang học chủ đề: ${topic}] ${question}`,
      mode: "rag",
      subject_id: subjectId,
      document_ids: [documentId],
    });
    return {
      answer: response.message.content,
      conversationId: response.message.conversation_id,
    };
  },
};
