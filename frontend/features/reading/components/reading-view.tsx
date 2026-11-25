"use client";

/**
 * Full-screen "Đọc sâu" (Immersive Reading) overlay.
 *
 * Layout: left = single-page PDF viewer (pdf.js), right = document-scoped AI
 * chat + notes/summary panel. Opened from a subject's document list; the PDF
 * bytes are fetched with the same auth-header blob download used by the
 * existing viewer. When the document is not indexed yet the overlay polls
 * the status endpoint and keeps the AI inputs disabled until it is ready.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X, BookOpen } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { httpClient } from "@/services/http-client";
import type { ApiDocument, DocumentStatus } from "@/features/subjects/services/document-api";
import { downloadDocumentBlob } from "@/features/subjects/services/document-api";
import { PdfViewer } from "./pdf-viewer";
import {
  ReadingChat,
  type ReadingMessage,
} from "./reading-chat";
import {
  listAnnotations,
  type ReadingAnnotation,
} from "@/features/reading/services/reading-api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const STATUS_LABEL: Record<DocumentStatus, string> = {
  uploading: "Đang tải lên…",
  uploaded: "Đã tải lên, đang chuẩn bị xử lý…",
  extracting: "Đang trích xuất nội dung…",
  ocr_processing: "Đang OCR trang quét & mô tả hình…",
  chunking: "Đang cắt chunk…",
  embedding: "Đang nhúng vector (Gemini)…",
  ready: "Sẵn sàng.",
  failed: "Xử lý thất bại.",
};

type ReadingViewProps = {
  document: ApiDocument;
  onClose: () => void;
};

export function ReadingView({ document, onClose }: ReadingViewProps) {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Live status: start from the prop, then poll while not ready.
  const [status, setStatus] = useState<DocumentStatus>(document.status);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [annotations, setAnnotations] = useState<ReadingAnnotation[]>([]);
  const [messages, setMessages] = useState<ReadingMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const ready = status === "ready";

  // ---- Poll document status until ready / failed --------------------------
  // The overlay is keyed per document in the parent, so this component
  // remounts (fresh `status` initialized from the prop) when the user opens
  // a different file; the effect below only *subscribes* to live updates.
  useEffect(() => {
    if (document.status === "ready" || document.status === "failed") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const data = await httpClient.get<{
          id: string;
          status: DocumentStatus;
          error_message?: string | null;
        }>(`/documents/${encodeURIComponent(document.id)}/status`);
        if (!stopped) {
          setStatus(data.status);
          if (data.status === "ready" || data.status === "failed") clearInterval(timer);
        }
      } catch {
        /* transient - keep polling */
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [document.id, document.status]);

  // ---- Load the PDF bytes --------------------------------------------------
  // Fresh component per document (keyed), so initial state is already null
  // and no synchronous reset is needed here.
  useEffect(() => {
    let cancelled = false;
    downloadDocumentBlob(document.id)
      .then((blob) => blob.arrayBuffer())
      .then((buf) => {
        if (!cancelled) setPdfData(buf);
      })
      .catch(() => {
        if (!cancelled) setPdfError("Không tải được tệp PDF.");
      });
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  // ---- Load annotations when the document is ready ------------------------
  // Guarded with a local flag so the effect only runs ONCE when `ready`
  // flips to true - a re-run on every `ready` change would fire the same
  // request repeatedly and, when the document is not yet indexed, raise an
  // uncaught 4xx that tears the whole workspace tree down (error boundary)
  // and makes the overlay "jump back to the subject page".
  const annotationsLoadedRef = useRef(false);
  const loadAnnotations = useCallback(() => {
    if (annotationsLoadedRef.current) return;
    annotationsLoadedRef.current = true;
    listAnnotations(document.id)
      .then((items) => {
        annotationsLoadedRef.current = false; // allow next `ready` run to refetch
        setAnnotations(items);
      })
      .catch(() => {
        /* transient (doc not indexed yet) - keep whatever list we have */
        annotationsLoadedRef.current = false;
      });
  }, [document.id]);
  useEffect(() => {
    if (ready) loadAnnotations();
  }, [ready, loadAnnotations]);

  // ---- Jump-to-page (from citations & notes) -----------------------------
  const jumpToPage = useCallback(
    (page: number) => setCurrentPage((p) => {
      const max = numPages ?? p;
      return Math.max(1, Math.min(max, page));
    }),
    [numPages],
  );

  // ---- Escape closes the overlay ------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const statusLine = status === "ready" ? "Sẵn sàng" : STATUS_LABEL[status];

  return (
    <div className="fixed inset-0 z-50 flex h-full w-full flex-col bg-card">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{document.filename}</p>
          <p className="text-[11px] text-muted-foreground">{statusLine}</p>
        </div>
        <Button variant="outline" size="icon" className="ml-auto size-8" onClick={onClose} aria-label="Đóng (Esc)">
          <X className="size-4" />
        </Button>
      </div>

      {/* Body */}
      {status === "failed" ? (
        <div className="grid flex-1 place-items-center p-6">
          <div style={{ maxWidth: "28rem", border: "1px solid color-mix(in srgb, var(--error) 40%, transparent)", background: "var(--error-soft)", borderRadius: "var(--radius-md)", padding: 20, fontSize: 14 }}>
            <p style={{ fontWeight: 500, color: "var(--error)" }}>Tài liệu chưa sẵn sàng.</p>
            <p className="meta" style={{ marginTop: 4 }}>
              {document.error_message ?? "Không thể index tài liệu này. Hãy xử lý lại trong thư viện môn học."}
            </p>
          </div>
        </div>
      ) : !pdfData ? (
        <div className="grid flex-1 place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Spinner className="size-8" />
            {pdfError ?? "Đang mở PDF…"}
          </div>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={62} minSize={30}>
            <PdfViewer
              data={pdfData}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onReady={setNumPages}
              highlightTexts={
                annotations
                  .filter((a) => a.type === "highlight" && a.page === currentPage)
                  .map((a) => a.text)
              }
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={38} minSize={25}>
            <ReadingChat
              documentId={document.id}
              documentName={document.filename}
              ready={ready}
              currentPage={currentPage}
              onJumpToPage={jumpToPage}
              annotations={annotations}
              onAnnotationsChanged={loadAnnotations}
              messages={messages}
              onMessages={setMessages}
              busy={busy}
              onBusy={setBusy}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
