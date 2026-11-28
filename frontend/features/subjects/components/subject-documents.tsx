"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import { FileText, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentPicker } from "./document-picker";
import { DocumentViewer } from "./document-viewer";
// Loaded lazily so pdf.js (pdfjs-dist) - which must only run in the browser -
// never enters the server-side render graph of the workspace page.
const ReadingView = lazy(() =>
  import("@/features/reading/components/reading-view").then((m) => ({ default: m.ReadingView })),
);
import { downloadDocument as triggerBrowserDownload } from "../services/document-preview";
import {
  formatFileSize,
  downloadDocumentBlob,
  listDocuments,
  removeDocument,
  reprocessDocument,
  uploadDocument,
  type ApiDocument,
  type DocumentStatus,
} from "../services/document-api";

const ALLOWED_DISPLAY = ["PDF"];

// A document stuck this long in a non-"ready"/"failed" status is very
// unlikely to still be legitimately working - process_document runs as a
// bare `asyncio.create_task` with no persistence, so a server restart
// mid-pipeline silently kills it with no error ever recorded. Below this,
// assume it may still be genuinely processing and hide the retry button
// (clicking it while the original task is actually still alive would start
// a second, racing run of the same pipeline).
const STUCK_THRESHOLD_MS = 3 * 60 * 1000;

function isStuckOrFailed(document: ApiDocument): boolean {
  if (document.status === "failed") return true;
  if (document.status === "ready" || document.status === "uploading") return false;
  return Date.now() - new Date(document.updated_at).getTime() > STUCK_THRESHOLD_MS;
}

type UploadItem = { file: File; progress: number; error?: string };

function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case "uploading":
      return "Đang upload";
    case "uploaded":
      return "Đã tải lên";
    case "extracting":
      return "Đang trích xuất";
    case "ocr_processing":
      return "Đang OCR";
    case "chunking":
      return "Đang phân đoạn";
    case "embedding":
      return "Đang tạo embedding";
    case "ready":
      return "Sẵn sàng";
    case "failed":
      return "Lỗi";
    default:
      return status;
  }
}

function statusBadgeClass(status: DocumentStatus): string {
  switch (status) {
    case "ready":
      return "pill pill-green";
    case "failed":
      return "pill pill-red";
    case "uploading":
    case "extracting":
    case "ocr_processing":
    case "chunking":
    case "embedding":
      return "pill pill-amber";
    case "uploaded":
    default:
      return "pill pill-blue";
  }
}

export function SubjectDocuments({ subjectId }: { subjectId: string }) {
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<ApiDocument | null>(null);
  const [viewing, setViewing] = useState<ApiDocument | null>(null);
  const [reading, setReading] = useState<ApiDocument | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  useEffect(() => {
    let disposed = false;
    // Re-fetch whenever the user navigates to a different subject.
    // `loading` starts as `true` and is flipped off when the request resolves.
    listDocuments(subjectId)
      .then((items) => {
        if (!disposed) {
          setDocuments(items);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setError(error instanceof Error ? error.message : "Không thể đọc tài liệu.");
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [subjectId]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể xử lý tài liệu.");
    } finally {
      setBusy(false);
    }
  }

  function updateUpload(fileName: string, patch: Partial<UploadItem>) {
    setUploads((current) =>
      current.map((item) => (item.file.name === fileName ? { ...item, ...patch } : item)),
    );
  }

  function removeUpload(fileName: string) {
    setUploads((current) => current.filter((item) => item.file.name !== fileName));
  }

  async function handleUpload() {
    if (!files.length) return;
    setError("");
    setNotice("");
    setBusy(true);

    // Pre-populate progress rows so the user can see all files at once.
    const initial: UploadItem[] = files.map((file) => ({ file, progress: 0 }));
    setUploads(initial);

    const results: ApiDocument[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        try {
          const doc = await uploadDocument(subjectId, file, (percent) => {
            updateUpload(file.name, { progress: percent });
          });
          updateUpload(file.name, { progress: 100 });
          results.push(doc);
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload thất bại.";
          updateUpload(file.name, { error: message });
          // Abort remaining uploads: surface the first failure to the user.
          throw uploadError;
        }
      }

      setDocuments((current) => [...results, ...current]);
      setFiles([]);
      setNotice(`Đã thêm ${results.length} tài liệu lên máy chủ.`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Không thể upload tài liệu lên máy chủ.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }} aria-label="Tài liệu môn học">
      <h3 className="row-between" style={{ marginBottom: 16 }}>
        <span>Tài liệu môn học</span>
      </h3>
      <DocumentPicker files={files} onChange={setFiles} disabled={busy} />
      <Button
        className="btn-accent"
        style={{ marginTop: 12 }}
        disabled={busy || loading || !files.length}
        onClick={() => void handleUpload()}
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> Đang tải lên...
          </>
        ) : (
          <>
            <FileUp /> Tải tài liệu lên máy chủ{files.length ? ` (${files.length})` : ""}
          </>
        )}
      </Button>

      {uploads.length > 0 && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }} aria-label="Tiến trình upload">
          {uploads.map((item) => (
            <li
              key={item.file.name}
              className="list-row"
              style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}
            >
              <FileText className="shrink-0" style={{ color: "var(--muted)" }} />
              <div className="grow">
                <p className="title">{item.file.name}</p>
                {item.error ? (
                  <p className="meta" style={{ color: "var(--error)" }}>{item.error}</p>
                ) : (
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
                      <div
                        style={{ height: "100%", background: "var(--accent)", borderRadius: 999, width: `${item.progress}%`, transition: "width 200ms var(--ease)" }}
                      />
                    </div>
                    <span className="meta" style={{ flexShrink: 0 }}>{item.progress}%</span>
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeUpload(item.file.name)}
                aria-label={`Bỏ ${item.file.name}`}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <div role="alert" className="error-box" style={{ marginTop: 12 }}>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="meta" style={{ marginTop: 12, color: "var(--accent-strong)" }}>
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="meta" style={{ marginTop: 20 }}>Đang tải tài liệu...</p>
      ) : documents.length === 0 ? (
        <p className="meta" style={{ marginTop: 20 }}>
          Chưa có tài liệu. Bạn có thể thêm giáo trình, slide hoặc bài tập tại đây.
        </p>
      ) : (
        <div className="scroll-list" style={{ marginTop: 20 }}>
          {documents.map((document, index) => (
            <div key={document.id} className="list-row" style={{ flexWrap: "wrap", border: index === documents.length - 1 ? 0 : "1px solid var(--border)" }}>
              <div className="grow">
                <p className="title">{document.filename}</p>
                <div className="meta" style={{ marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span>{formatFileSize(document.file_size)}</span>
                  <span>·</span>
                  <span style={{ textTransform: "uppercase" }}>{document.file_type || "?"}</span>
                  <span>·</span>
                  <span className={statusBadgeClass(document.status)} style={{ height: 20 }}>
                    {statusLabel(document.status)}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setViewing(document)}
                  aria-label={`Xem ${document.filename}`}
                >
                  Xem
                </Button>
                {document.file_type?.toLowerCase() === "pdf" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || document.status === "failed"}
                    onClick={() => setReading(document)}
                    aria-label={`Đọc ${document.filename}`}
                  >
                    Đọc
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const blob = await downloadDocumentBlob(document.id);
                      triggerBrowserDownload(document.filename, blob);
                    })
                  }
                >
                  Tải xuống
                </Button>
                {isStuckOrFailed(document) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const updated = await reprocessDocument(document.id);
                        setDocuments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
                        setNotice("Đã gửi yêu cầu xử lý lại — tải lại trang sau ít phút để xem trạng thái mới.");
                      })
                    }
                    aria-label={`Xử lý lại ${document.filename}`}
                  >
                    Xử lý lại
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDeleting(document)}
                  aria-label={`Xóa ${document.filename}`}
                >
                  Xóa
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && <DocumentViewer key={viewing.id} document={viewing} onClose={() => setViewing(null)} />}

      {reading && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 grid place-items-center bg-card text-sm text-muted-foreground">
              Đang mở chế độ đọc...
            </div>
          }
        >
          <ReadingView key={reading.id} document={reading} onClose={() => setReading(null)} />
        </Suspense>
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Xóa tài liệu?</DialogTitle>
            <DialogDescription className="break-words text-muted-foreground">
              {deleting?.filename} sẽ bị xóa khỏi máy chủ và cơ sở dữ liệu.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (!deleting) return;
                  await removeDocument(deleting.id);
                  setDocuments((current) => current.filter((item) => item.id !== deleting.id));
                  setDeleting(null);
                  setNotice("Đã xóa tài liệu.");
                })
              }
            >
              Xóa tài liệu
            </Button>
          </div>
          {error ? (
            <div role="alert" className="error-box">
              <p>{error}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

// Re-export for downstream code if needed.
export { ALLOWED_DISPLAY };
