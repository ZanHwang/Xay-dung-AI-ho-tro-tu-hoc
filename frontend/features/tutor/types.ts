// =============================================================================
// Frontend Types
// =============================================================================

export type ChatRole = "user" | "assistant";

export type ChatImage = { id: string; name: string; type: string; size: number };

export type MessageSource = {
  document_id?: string;
  document_name?: string;
  page?: string | number | null;
  chunk_id?: string;
  content_preview?: string;
  // Figure image filename stored at index time (figures/<doc_id>/<name>);
  // shown as a thumbnail on the source line.
  figure?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  images?: ChatImage[];
  documents?: ChatImage[];
  // Structured RAG citations returned by the backend (document name + page).
  sources?: MessageSource[];
  // Whether the reply was grounded in retrieved documents (true = RAG,
  // false/undefined = plain chat knowledge). Shown as a small source line.
  grounded?: boolean;
  // Backend fields
  conversation_id?: string;
  metadata?: string;
  created_at?: string;
};

export type Conversation = {
  classification?: "automatic" | "manual" | "uncertain" | "general";
  id: string;
  subjectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
  messages: ChatMessage[];
  // Trusted total from the server when the local view hasn't loaded the
  // messages yet (list conversations), so the sidebar shows the real count.
  messageCount?: number;
};

export type TutorRequest = {
  conversationId: string;
  subjectId: string | null;
  subjectName?: string;
  messages: ChatMessage[];
};

// =============================================================================
// Backend API Types
// =============================================================================

export interface ApiConversation {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
}

export interface ConversationListResponse {
  total: number;
  conversations: ApiConversation[];
}

export interface ApiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: string;
  message_metadata?: string;
  created_at: string;
}

export interface MessageListResponse {
  total: number;
  messages: ApiMessage[];
}

export interface ChatRequest {
  conversation_id?: string;
  content: string;
  mode?: "chat" | "rag";
  document_ids?: string[];
  subject_id?: string;
  attachment_ids?: string[];
}

export interface ChatResponse {
  message: ApiMessage;
  sources?: unknown[];
  new_conversation: boolean;
}
