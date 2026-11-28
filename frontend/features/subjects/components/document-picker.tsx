"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatFileSize, MAX_FILE_SIZE } from "../services/document-api";

type Props = { files: File[]; onChange: (files: File[]) => void; disabled?: boolean };

export function DocumentPicker({ files, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(selected: File[]) {
    const next = [...files];
    for (const file of selected) {
      if (!next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="field">
        Thêm tài liệu
        {/* Native file inputs render their own "Choose Files / No file
            chosen" text, which can't be relabeled — hide it and trigger it
            from a plain button instead; the chosen files already list
            below, so there's nothing the native status text would add. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
            Chọn file
          </Button>
          <span className="meta">{files.length === 0 ? "Chưa chọn file nào" : `Đã chọn ${files.length} file`}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            handleFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {files.length > 0 ? (
        <ul className="max-h-40 space-y-2 overflow-y-auto" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Tài liệu đang chọn">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className="list-row" style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, border: 0 }}>
              <span className="grow title">{file.name}</span>
              <span className="meta shrink-0">{formatFileSize(file.size)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Bỏ chọn ${file.name}`}
                onClick={() => onChange(files.filter((_, position) => position !== index))}>Bỏ</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="meta">
        Chỉ nhận PDF (Word/PowerPoint hãy xuất sang PDF trước) — tối đa {MAX_FILE_SIZE / (1024 * 1024)}MB mỗi file.
      </p>
    </div>
  );
}
