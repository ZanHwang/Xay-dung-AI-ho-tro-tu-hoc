"use client";

import { useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { examApi, type ExamFile } from "../services/exam-api";

export const fileRoles = { exam: "Đề thi", answer: "Bài làm", official: "Đáp án chính thức" };

export function ExamFilePicker({
  label, files, onChange, optional = false, disabled = false, tone = "cover-cyan",
}: {
  label: string; files: File[]; onChange: (files: File[]) => void; optional?: boolean; disabled?: boolean;
  /** Cover color of the file icon. */
  tone?: string;
}) {
  return (
    <label className="slot">
      <span className={`file-ic ${tone}`} aria-hidden="true">
        <Upload className="size-5" />
      </span>
      <span className="slot-text">
        <b>{label}</b>
        <small>
          {files.length ? files.map((file) => file.name).join(", ") : optional ? "Không bắt buộc" : "Chưa chọn tệp"}
        </small>
      </span>
      <span className="btn btn-outline shrink-0" aria-hidden="true">Chọn tệp</span>
      <input
        className="sr-only"
        aria-label={label}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        multiple
        disabled={disabled}
        onChange={(event) => onChange(Array.from(event.currentTarget.files ?? []))}
      />
    </label>
  );
}

function OriginalFile({ submissionId, file }: { submissionId: string; file: ExamFile }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    let objectUrl = "";
    examApi.file(submissionId, file.id).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((err: unknown) => {
      if (current) setError(err instanceof Error ? err.message : "Chưa tải được bản gốc.");
    });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [submissionId, file.id]);

  if (error) return <p role="alert" className="error-box">{error}</p>;
  if (!url) return <p role="status" className="meta">Đang tải bản gốc…</p>;
  return (
    <div className="space-y-3">
      {file.media_type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="mx-auto max-h-[60vh] max-w-full object-contain" />
      ) : null}
      <div className="flex gap-2">
        <a className="btn btn-sm btn-outline" href={url} target="_blank" rel="noopener noreferrer">Mở bản gốc</a>
        <a className="btn btn-sm btn-outline" href={url} download={file.name}>Tải xuống</a>
      </div>
    </div>
  );
}

export function ExamOriginals({ submissionId, files }: { submissionId: string; files: ExamFile[] }) {
  const [selected, setSelected] = useState<ExamFile | null>(null);
  if (!files.length) return null;
  return (
    <section className="space-y-2">
      <h4 className="font-semibold">Tệp gốc</h4>
      <div className="flex flex-wrap gap-2">
        {files.map((file) => (
          <Button
            type="button" key={file.id} variant="outline" size="sm"
            className="max-w-full" onClick={() => setSelected(file)}
          >
            <FileText aria-hidden />
            <span className="truncate">{fileRoles[file.role]} · {file.name}</span>
          </Button>
        ))}
      </div>
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        {selected ? (
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="break-all">{selected.name}</DialogTitle>
              <DialogDescription>{fileRoles[selected.role]}</DialogDescription>
            </DialogHeader>
            <OriginalFile key={selected.id} submissionId={submissionId} file={selected} />
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
