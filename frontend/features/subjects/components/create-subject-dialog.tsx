"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CreateSubjectInput } from "@/features/subjects/types";
import { DocumentPicker } from "./document-picker";

type CreateSubjectDialogProps = {
  onCreate: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
};

export function CreateSubjectDialog({ onCreate }: CreateSubjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await onCreate({ name, description }, files);
      setName(""); setDescription(""); setFiles([]); setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể tạo môn học. Hãy thử lại.");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { setOpen(next); setError(""); } }}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Tạo môn học
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo môn học mới</DialogTitle>
          <DialogDescription>
            Môn học sẽ được lưu trên trình duyệt của thiết bị này.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="field">
            Tên môn học
            <Input
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              className="input"
              placeholder="Ví dụ: Khai phá dữ liệu"
            />
          </label>
          <label className="field">
            Mô tả
            <Input
              value={description}
              disabled={saving}
              onChange={(event) => setDescription(event.target.value)}
              className="input"
              placeholder="Nội dung chính của môn học"
            />
          </label>
          <DocumentPicker files={files} onChange={setFiles} disabled={saving} />
          {error ? (
            <div role="alert" className="error-box">
              <p>{error}</p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Hủy
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || saving}
          >
            {saving ? "Đang lưu môn và tài liệu..." : "Tạo môn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
