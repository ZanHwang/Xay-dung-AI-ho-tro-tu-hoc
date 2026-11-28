import { httpClient } from "@/services/http-client";
import type {
  ApiConversation,
  ApiMessage,
  ChatImage,
  ChatRequest,
  ChatResponse,
  Conversation,
  ChatMessage,
  ConversationListResponse,
  MessageListResponse,
  MessageSource,
} from "../types";

// =============================================================================
// Map Backend to Frontend
// =============================================================================

function mapConversation(api: ApiConversation): Conversation {
  return {
    id: api.id,
    subjectId: api.subject_id,
    title: api.title,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    lastMessage: api.last_message,
    // The list endpoint carries the real message count; the bodies are
    // fetched lazily when a conversation is opened (useConversations.loadMessages).
    messageCount: api.message_count ?? 0,
    messages: [],
  };
}

function mapMessage(api: ApiMessage): ChatMessage {
  // Assistant messages carry {"sources": [...], "mode": "..."} in
  // message_metadata so a reloaded history re-renders the source line the
  // same way a live reply does.
  let sources: MessageSource[] | undefined;
  let grounded: boolean | undefined;
  let images: ChatImage[] | undefined;
  let documents: ChatImage[] | undefined;
  if (api.message_metadata) {
    try {
      const meta: unknown = JSON.parse(api.message_metadata);
      // User messages carry {"attachments": [...]} - files kept on the server,
      // so a conversation shows its images/PDFs on every device.
      const attachments = meta && typeof meta === "object" && Array.isArray((meta as { attachments?: unknown[] }).attachments)
        ? (meta as { attachments: ChatImage[] }).attachments.filter((item) => item && typeof item.id === "string")
        : [];
      if (attachments.length) {
        images = attachments.filter((item) => item.type.startsWith("image/"));
        documents = attachments.filter((item) => !item.type.startsWith("image/"));
      }
      const rawSources =
        meta && typeof meta === "object" && Array.isArray((meta as { sources?: unknown[] }).sources)
          ? (meta as { sources: unknown[] }).sources
          : [];
      const parsed = rawSources.filter(
        (item): item is MessageSource => item !== null && typeof item === "object"
      );
      if (parsed.length) sources = parsed;
      // A RAG reply that found nothing is still "documents were in play"
      // (grounded), so the UI says "không tìm thấy nội dung phù hợp"
      // instead of the misleading "tri thức chung".
      const ragMiss = api.content.startsWith("Xin lỗi, tôi không tìm thấy thông tin liên quan");
      if (api.role === "assistant") grounded = parsed.length > 0 || ragMiss;
    } catch {
      // Malformed metadata: just skip the source line.
    }
  }
  return {
    id: api.id,
    role: api.role,
    content: api.content,
    timestamp: new Date(api.created_at).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    conversation_id: api.conversation_id,
    metadata: api.message_metadata,
    created_at: api.created_at,
    sources,
    grounded,
    images,
    documents,
  };
}

// =============================================================================
// Chat API Service
// =============================================================================

export const chatApi = {
  /**
   * List conversations for current user
   */
  async listConversations(params?: {
    subject_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; conversations: Conversation[] }> {
    const searchParams = new URLSearchParams();
    if (params?.subject_id) searchParams.set("subject_id", params.subject_id);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());

    const query = searchParams.toString();
    const url = `/conversations/${query ? `?${query}` : ""}`;

    const response: ConversationListResponse = await httpClient.get(url);

    return {
      total: response.total,
      conversations: response.conversations.map(mapConversation),
    };
  },

  /**
   * Get single conversation
   */
  async getConversation(id: string): Promise<Conversation> {
    const api: ApiConversation = await httpClient.get(`/conversations/${id}`);
    return mapConversation(api);
  },

  /**
   * Create new conversation
   */
  async createConversation(data: {
    subject_id?: string;
    title?: string;
  }): Promise<Conversation> {
    const payload: Record<string, unknown> = {};
    if (data.subject_id) payload.subject_id = data.subject_id;
    if (data.title) payload.title = data.title;

    const api: ApiConversation = await httpClient.post("/conversations/", payload);
    return mapConversation(api);
  },

  /**
   * Update conversation title
   */
  async updateConversation(id: string, title: string): Promise<Conversation> {
    const api: ApiConversation = await httpClient.put(`/conversations/${id}`, {
      title,
    });
    return mapConversation(api);
  },

  /**
   * Delete conversation
   */
  async deleteConversation(id: string): Promise<void> {
    await httpClient.delete(`/conversations/${id}`);
  },

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ total: number; messages: ChatMessage[] }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());

    const query = searchParams.toString();
    const url = `/conversations/${conversationId}/messages${query ? `?${query}` : ""}`;

    const response: MessageListResponse = await httpClient.get(url);

    return {
      total: response.total,
      messages: response.messages.map(mapMessage),
    };
  },

  /**
   * Send chat message and get AI response
   */
  async sendChat(request: ChatRequest): Promise<{
    message: ChatMessage;
    sources?: unknown[];
    new_conversation: boolean;
    conversation_id?: string;
  }> {
    const response: ChatResponse = await httpClient.post("/conversations/chat", request);

    return {
      message: mapMessage(response.message),
      sources: response.sources,
      new_conversation: response.new_conversation,
      conversation_id: response.message.conversation_id,
    };
  },
};

// =============================================================================
// Demo/Mock Data (for development without backend)
// =============================================================================

const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    subjectId: "demo-1",
    title: "Giải tích - Đạo hàm",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    lastMessage: "Đạo hàm của hàm hợp...",
    messages: [],
  },
  {
    id: "conv-2",
    subjectId: "demo-3",
    title: "Python - List comprehension",
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    lastMessage: "Cách sử dụng map() và filter()...",
    messages: [],
  },
];

/**
 * Get demo conversations (for development/fallback)
 */
export function getDemoConversations(): Conversation[] {
  return DEMO_CONVERSATIONS;
}
