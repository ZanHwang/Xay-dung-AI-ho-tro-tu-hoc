"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadDocument, prepareDocumentPreview, type DocumentPreview } from "../services/document-preview";
import { downloadDocumentBlob, formatFileSize, type ApiDocument } from "../services/document-api";

type LoadedDocument = { blob: Blob; preview: DocumentPreview; url: string | null };

export function DocumentViewer({ document, onClose }: { document: ApiDocument; onClose: () => void }) {
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    async function load() {
      try {
        const blob = await downloadDocumentBlob(document.id);
        if (disposed) return;
        const preview = await prepareDocumentPreview(document.filename, blob);
        if (disposed) return;
        if (preview.kind === "pdf" || preview.kind === "image") {
          objectUrl = URL.createObjectURL(preview.blob);
        }
        setLoaded({ blob, preview, url: objectUrl });
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "Không thể mở tài liệu.");
        }
      }
    }
    void load();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, document.filename]);

  const preview = loaded?.preview;
  const showPdfFallback = preview?.kind === "pdf" && loaded && !loaded.url;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90svh] w-[calc(100%-2rem)] max-w-6xl flex-col gap-3 overflow-hidden sm:max-w-6xl">
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle className="break-words">{document.filename}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Tài liệu của môn học, {formatFileSize(document.file_size)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-lg border border-border bg-secondary">
          {error ? <p role="alert" className="err p-6 text-sm">{error}</p> : !loaded
            ? <p role="status" className="meta p-6 text-sm">Đang mở tài liệu...</p> : null}
          {preview?.kind === "pdf" && loaded?.url && (
            <>
              <p className="shrink-0 p-2 text-xs text-muted-foreground">Nếu trình duyệt không hiển thị PDF, bạn có thể tải xuống để xem.</p>
              <iframe src={loaded.url} title={`Nội dung ${document.filename}`} className="min-h-80 w-full flex-1 border-0 bg-card" />
            </>
          )}
          {showPdfFallback && (
            <div className="m-auto max-w-lg p-6 text-center">
              <h3 className="font-semibold text-foreground">Trình duyệt không thể hiển thị PDF này</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">File có thể đã bị hỏng hoặc không đúng định dạng. Hãy tải xuống để mở bằng ứng dụng PDF.</p>
            </div>
          )}
          {preview?.kind === "image" && loaded?.url && (imageFailed
            ? <p role="alert" className="err p-6 text-sm">Không thể hiển thị ảnh. Hãy tải xuống để kiểm tra file.</p>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={loaded.url} alt={document.filename} onError={() => setImageFailed(true)} className="m-auto max-h-full max-w-full object-contain" />)}
          {preview?.kind === "text" && (
            <>
              {preview.truncated && <p className="warn p-3 text-sm">Đang hiển thị 2 MB đầu tiên. Tải xuống để đọc toàn bộ tài liệu.</p>}
              <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-foreground">{preview.text || "Tài liệu không có nội dung văn bản."}</pre>
            </>
          )}
          {preview?.kind === "unsupported" && (
            <div className="m-auto max-w-lg p-6 text-center">
              <h3 className="font-semibold text-foreground">Định dạng này chưa hỗ trợ xem trực tiếp</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Bạn có thể tải file Word, PowerPoint, Excel hoặc định dạng khác về để mở bằng ứng dụng phù hợp. Hiện hỗ trợ xem PDF, ảnh và văn bản.</p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button disabled={!loaded} onClick={() => { if (loaded) downloadDocument(document.filename, loaded.blob); }}>Tải xuống</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
