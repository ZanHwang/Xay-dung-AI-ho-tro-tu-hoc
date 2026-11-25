/**
 * Reading workspace API service.
 *
 * Mirrors the backend /api/reading endpoints (see backend/app/routers/reading.py).
 * Reuses the same base-URL + auth helpers as document-api.ts to keep one source
 * of truth for fetch + Bearer wiring.
 */
import { buildUrl, buildAuthHeaders, parseErrorFromResponse } from "@/features/subjects/services/document-api";
import type { MessageSource } from "@/features/tutor/types";

// Reuse the exact MessageSource type already defined in tutor/types.ts so the
// frontend and backend stay aligned without duplication.
export type ReadingSource = MessageSource;

export interface ReadingAnnotation {
  id: string;
  document_id: string;
  page: number | null;
  text: string;
  type: "note" | "highlight" | "summary";
  created_at: string;
}

export interface ReadingAskResult {
  answer: string;
  sources: ReadingSource[];
  figure_note: string | null;
  // Set when the question was a "summarize" request the backend routed to the
  // summarization engine (reads the PDF, not RAG); the summary is also saved
  // to the notes panel.
  kind?: string; // "summary"
  pages?: number[]; // [from_page, to_page] when kind === "summary"
}

// One row of the document-scoped Q&A history (its own table, NOT the Tutor
// conversation system).
export interface ReadingChatHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ReadingSource[] | null;
  figure_note?: string | null;
  kind?: string | null; // "summary" when the answer was a summarize intent
  label?: string | null; // e.g. "Tóm tắt trang 1-26"
  created_at: string;
}

export interface ReadingChatAppendPayload {
  user_message?: string;
  assistant_message?: string;
  sources?: ReadingSource[] | null;
  figure_note?: string | null;
  kind?: string | null;
  label?: string | null;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function jsonHeaders(): Record<string, string> {
  return buildAuthHeaders(true);
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), { ...init, headers: jsonHeaders() });
  if (!response.ok) {
    return parseErrorFromResponse(response, `Yêu cầu thất bại (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

export async function askReadingQuestion(
  documentId: string,
  question: string,
  contextPages?: number[],
): Promise<ReadingAskResult> {
  return jsonRequest<ReadingAskResult>(
    `/reading/${encodeURIComponent(documentId)}/ask`,
    {
      method: "POST",
      body: JSON.stringify({ question, context_pages: contextPages ?? undefined }),
    },
  );
}

// ---------------------------------------------------------------------------
// Per-document Q&A history (its own table - separate from the Tutor system)
// ---------------------------------------------------------------------------

export async function listReadingChatHistory(documentId: string): Promise<ReadingChatHistoryMessage[]> {
  return jsonRequest<ReadingChatHistoryMessage[]>(
    `/reading/${encodeURIComponent(documentId)}/chat-history`,
    { method: "GET" },
  );
}

export async function appendReadingChatHistory(
  documentId: string,
  payload: ReadingChatAppendPayload,
): Promise<void> {
  await jsonRequest<void>(
    `/reading/${encodeURIComponent(documentId)}/chat-history`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export async function listAnnotations(documentId: string): Promise<ReadingAnnotation[]> {
  return jsonRequest<ReadingAnnotation[]>(
    `/reading/${encodeURIComponent(documentId)}/annotations`,
    { method: "GET" },
  );
}

export async function createAnnotation(
  documentId: string,
  body: { page?: number; text: string; type?: "note" | "highlight" },
): Promise<ReadingAnnotation> {
  return jsonRequest<ReadingAnnotation>(
    `/reading/${encodeURIComponent(documentId)}/annotations`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function deleteAnnotation(documentId: string, annotationId: string): Promise<void> {
  await jsonRequest<void>(
    `/reading/${encodeURIComponent(documentId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "DELETE" },
  );
}
