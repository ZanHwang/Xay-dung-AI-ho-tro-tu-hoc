"use client";

import { useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { examApi, type ExamFile } from "../services/exam-api";

export const fileRoles = { exam: "Đề thi", answer: "Bài làm", official: "Đáp án chính thức" };

export function ExamFilePicker({
  label, files, onChange, optional = false, disabled = false,
}: {
  label: string; files: File[]; onChange: (files: File[]) => void; optional?: boolean; disabled?: boolean;
}) {
  return (
    <label className="block cursor-pointer rounded-xl border border-dashed p-3 focus-within:ring-2 focus-within:ring-ring">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Upload className="size-4" aria-hidden /> {label}
        {optional ? <span className="meta">Tuỳ chọn</span> : null}
      </span>
      <input
        className="sr-only"
        aria-label={label}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        multiple
        disabled={disabled}
        onChange={(event) => onChange(Array.from(event.currentTarget.files ?? []))}
      />
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md border bg-background px-2.5 py-1.5 font-medium">Chọn tệp</span>
        <span className="meta">{files.length ? `Đã chọn ${files.length} tệp` : "Chưa chọn tệp"}</span>
      </span>
      {files.length ? <span className="meta mt-1.5 block break-words">{files.map((file) => file.name).join(", ")}</span> : null}
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
