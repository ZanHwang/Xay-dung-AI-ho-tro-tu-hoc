import { httpClient, getAuthToken } from "@/services/http-client";

// =============================================================================
// Backend API Types
// =============================================================================

/** Mirrors backend DocumentResponse (see backend/app/schemas/document.py). */
export type DocumentStatus =
  | "uploading"
  | "uploaded"
  | "extracting"
  | "ocr_processing"
  | "chunking"
  | "embedding"
  | "ready"
  | "failed";

export interface ApiDocument {
  id: string;
  user_id: string;
  subject_id: string | null;
  filename: string;
  file_type: string;
  file_size: number | null;
  status: DocumentStatus;
  total_pages: number | null;
  metadata: string | null;
  error_message: string | null;
  // This document's own AI-detected topics, already ordered - used to group
  // "Tạo Quiz" chips and Lộ trình per document (see backend Document.topics).
  topics: string[];
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  total: number;
  documents: ApiDocument[];
}

// =============================================================================
// Config
// =============================================================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB - must match backend
// Keep in sync with backend/app/services/document_service.py ALLOWED_EXTENSIONS.
export const ALLOWED_EXTENSIONS = ["pdf"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

// =============================================================================
// Helpers
// =============================================================================

// Exported so other services (e.g. features/reading/services/reading-api.ts)
// reuse the exact same base-URL + auth rules instead of duplicating them.
export function buildUrl(path: string): string {
  // If API_BASE_URL already ends with /api, do not double it up.
  const base = API_BASE_URL.endsWith("/api")
    ? API_BASE_URL
    : `${API_BASE_URL}/api`;
  return `${base}${path}`;
}

export function buildAuthHeaders(includeContentType = true): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function parseErrorFromResponse(response: Response, fallback: string): Promise<never> {
  return response.text().then((text) => {
    let message = fallback;
    if (text) {
      try {
        const data = JSON.parse(text);
        message = data.detail || data.message || message;
      } catch {
        // Non-JSON body (e.g. HTML error page) - keep fallback.
        if (text.length < 200) message = text;
      }
    }
    throw new Error(message);
  });
}

// =============================================================================
// Frontend mapping helpers
// =============================================================================

/** Convenience mapper that hides the `subject_id: null` case from UI code. */
export function mapApiDocument(api: ApiDocument): ApiDocument {
  return api;
}

// =============================================================================
// Validation helpers
// =============================================================================

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

export function isAllowedDocument(name: string, size: number): { ok: boolean; reason?: string } {
  if (size > MAX_FILE_SIZE) {
    return { ok: false, reason: `File vượt quá ${MAX_FILE_SIZE / (1024 * 1024)}MB.` };
  }
  const ext = getFileExtension(name);
  if (!ALLOWED_EXTENSIONS.includes(ext as AllowedExtension)) {
    return {
      ok: false,
      reason: `Định dạng .${ext || "?"} chưa được hỗ trợ. Chỉ nhận PDF — hãy chuyển file Word/PowerPoint sang PDF trước khi tải lên.`,
    };
  }
  return { ok: true };
}

export function formatFileSize(size: number | null | undefined): string {
  const value = size ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// =============================================================================
// Document API Service
// =============================================================================

/**
 * List documents attached to a subject.
 * Calls `GET /api/documents?subject_id={id}`.
 */
export async function listDocuments(subjectId: string): Promise<ApiDocument[]> {
  const response: DocumentListResponse = await httpClient.get(
    `/documents/?subject_id=${encodeURIComponent(subjectId)}`,
  );
  return response.documents;
}

/**
 * Upload a single file to the backend.
 * Uses fetch directly because the shared httpClient only supports JSON bodies
 * and we need multipart/form-data + Authorization header.
 *
 * `subjectId` is optional: when omitted the document is uploaded standalone
 * (not attached to any subject), which is what chat attachments do - the file
 * is then indexed for RAG and can later be attached to a subject if wanted.
 */
export async function uploadDocument(
  subjectId: string | undefined,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ApiDocument> {
  // Validate before doing any network work.
  const validation = isAllowedDocument(file.name, file.size);
  if (!validation.ok) {
    throw new Error(validation.reason ?? "File không hợp lệ.");
  }

  const formData = new FormData();
  formData.append("file", file);
  if (subjectId) formData.append("subject_id", subjectId);

  return new Promise<ApiDocument>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl("/documents/"));
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as ApiDocument;
          if (onProgress) onProgress(100);
          resolve(data);
        } catch {
          reject(new Error("Phản hồi từ máy chủ không hợp lệ."));
        }
      } else {
        let message = `Upload thất bại (${xhr.status}).`;
        try {
          const data = JSON.parse(xhr.responseText);
          message = data.detail || data.message || message;
        } catch {
          // Keep generic message.
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Không thể kết nối máy chủ. Vui lòng kiểm tra mạng."));
    xhr.onabort = () => reject(new Error("Đã hủy upload."));

    xhr.send(formData);
  });
}

/** Poll the status endpoint until the background RAG pipeline finishes. */
async function waitForDocumentIndexed(documentId: string, timeoutMs = 600000): Promise<ApiDocument> {
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  while (Date.now() < deadline) {
    const response = await httpClient.get<ApiDocument>(
      `/documents/${encodeURIComponent(documentId)}/status`,
    );
    if (response.status === "ready") return response;
    if (response.status === "failed") {
      throw new Error(response.error_message ?? "Không xử lý được tài liệu.");
    }
    await sleep(2000);
  }
  throw new Error("Tài liệu đang xử lý, vui lòng thử lại sau.");
}

/**
 * Upload a standalone document (no subject) and wait for its RAG index.
 * Used for chat attachments: the returned id is safe to query in Qdrant.
 * Returns null if the document could not be indexed (so the caller can fall
 * back to plain chat rather than block the message).
 */
export async function uploadAndIndexDocument(file: File): Promise<string | null> {
  try {
    const doc = await uploadDocument(undefined, file);
    await waitForDocumentIndexed(doc.id);
    return doc.id;
  } catch (error) {
    console.error("Failed to index chat attachment:", error);
    return null;
  }
}

/**
 * Upload a document INTO a subject's library and wait for its RAG index.
 * Used when a chat attachment is explicitly "save to subject X": the file
 * becomes part of that subject's documents (visible on the subject page)
 * and is indexed for RAG. Returns null on failure.
 */
export async function uploadAndIndexDocumentForSubject(
  subjectId: string,
  file: File,
): Promise<string | null> {
  try {
    const doc = await uploadDocument(subjectId, file);
    await waitForDocumentIndexed(doc.id);
    return doc.id;
  } catch (error) {
    console.error("Failed to index document for subject:", error);
    return null;
  }
}

/**
 * Download a document by id, returns the raw Blob.
 * Uses fetch directly because the response is binary and the httpClient
 * only decodes JSON.
 */
export async function downloadDocumentBlob(id: string): Promise<Blob> {
  // Use the dedicated download endpoint so the response is a file stream
  // rather than the JSON metadata returned by `GET /documents/{id}`.
  const response = await fetch(buildUrl(`/documents/${encodeURIComponent(id)}/download`), {
    method: "GET",
    headers: buildAuthHeaders(false),
  });

  if (!response.ok) {
    return parseErrorFromResponse(response, `Tải xuống thất bại (${response.status}).`);
  }

  return response.blob();
}

/**
 * Delete a document by id.
 * Calls `DELETE /api/documents/{id}`.
 */
export async function removeDocument(id: string): Promise<void> {
  await httpClient.delete(`/documents/${encodeURIComponent(id)}`);
}

/**
 * Re-queue processing for a document that failed or got stuck (e.g. the
 * background task died with the server process - process_document runs as
 * a bare `asyncio.create_task`, so it leaves no trace if the process
 * restarts mid-pipeline). Resets status to "uploaded" and starts over.
 * Calls `POST /api/documents/{id}/reprocess`.
 */
export async function reprocessDocument(id: string): Promise<ApiDocument> {
  return httpClient.post<ApiDocument>(`/documents/${encodeURIComponent(id)}/reprocess`, {});
}

/**
 * Fetch an extracted figure image for a document as a Blob.
 * The endpoint is auth-protected, so this uses the same fetch + header
 * pattern as `downloadDocumentBlob` (an `<img>` cannot send headers).
 */
export async function downloadDocumentFigure(documentId: string, filename: string): Promise<Blob> {
  const response = await fetch(
    buildUrl(`/documents/${encodeURIComponent(documentId)}/figures/${encodeURIComponent(filename)}`),
    { method: "GET", headers: buildAuthHeaders(false) }
  );
  if (!response.ok) {
    return parseErrorFromResponse(response, `Không tải được hình (${response.status}).`);
  }
  return response.blob();
}

/**
 * Rasterized image of one page of the document's original PDF (see Lộ trình
 * "Học" screen's excerpts). Same auth-protected fetch pattern as
 * `downloadDocumentFigure` - an `<img src>` cannot send a bearer header.
 */
export async function downloadDocumentPage(documentId: string, pageNo: number): Promise<Blob> {
  const response = await fetch(
    buildUrl(`/documents/${encodeURIComponent(documentId)}/pages/${pageNo}/image`),
    { method: "GET", headers: buildAuthHeaders(false) }
  );
  if (!response.ok) {
    return parseErrorFromResponse(response, `Không tải được trang (${response.status}).`);
  }
  return response.blob();
}

// =============================================================================
// Public service object
// =============================================================================

export const documentApi = {
  list: listDocuments,
  upload: uploadDocument,
  download: downloadDocumentBlob,
  remove: removeDocument,
  reprocess: reprocessDocument,
};
