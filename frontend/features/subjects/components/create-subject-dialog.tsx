"use client";

import { useEffect, useState } from "react";
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
import { accentToColor, COVER_OPTIONS, type CreateSubjectInput, type SubjectAccent } from "@/features/subjects/types";
import { subjectApi } from "@/features/subjects/services/subject-api";
import { CoverPicker } from "./cover-picker";
import { DocumentPicker } from "./document-picker";

type CreateSubjectDialogProps = {
  onCreate: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  /** Custom button that opens the dialog (the blank notebook in the grid). */
  trigger?: React.ReactElement;
};

function randomCover(): SubjectAccent {
  return COVER_OPTIONS[Math.floor(Math.random() * COVER_OPTIONS.length)].accent;
}

export function CreateSubjectDialog({ onCreate, trigger }: CreateSubjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [cover, setCover] = useState<SubjectAccent>("cyan");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Existing subject names (across EVERY user, see subjectApi.getKnownNames) -
  // clicking one reuses the exact name instead of a slightly different
  // spelling, so this subject's quiz generation lands on the SAME shared
  // question bank as those other subjects (keyed by subject name - see
  // backend subject_key_for). Fetched ONCE (no query - the backend's own
  // default already returns a generous batch) and filtered client-side as
  // the user types (see filteredKnownNames below) - a per-keystroke network
  // round trip felt noticeably laggy compared to typing speed. A debounced
  // background search (extraNames below) backs this up for anything beyond
  // this list's own cap.
  const [knownNames, setKnownNames] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    subjectApi.getKnownNames().then((names) => {
      if (!cancelled) setKnownNames(names);
    }).catch(() => {
      // Best-effort: just skip suggestions this time.
    });
    return () => { cancelled = true; };
  }, [open]);

  // Backup for names beyond knownNames' own cap (currently 300, see backend
  // SubjectService.get_known_names): asks the backend directly for THIS
  // typed text, debounced, so an exact existing name that happens to sort
  // past the cap still gets found eventually - just not instantly like the
  // client-side filter above. `cancelled` guards against an out-of-order
  // response overwriting a newer one (clearTimeout alone only stops a
  // request that hasn't fired yet, not one already in flight).
  const [extraNames, setExtraNames] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !name.trim()) { setExtraNames([]); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      subjectApi.getKnownNames(name).then((names) => {
        if (!cancelled) setExtraNames(names);
      }).catch(() => {
        // Best-effort: the instant client-side list below still works.
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, name]);

  // Only hide an EXACT (case-sensitive) match - a different-case one ("NLP"
  // vs typed "nlp") still needs suggesting, since they'd otherwise become
  // two separate subjects (same shared question bank either way -
  // subject_key_for lowercases - but the subject itself, its own documents/
  // progress/quizzes, would NOT be unified).
  const filteredKnownNames = name.trim()
    ? Array.from(new Set([
        ...knownNames.filter((n) => n.toLowerCase().includes(name.trim().toLowerCase())),
        ...extraNames,
      ])).filter((n) => n !== name.trim())
    : [];

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await onCreate({ name, description, color: accentToColor(cover) }, files);
      setName(""); setDescription(""); setFiles([]); setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể tạo môn học. Hãy thử lại.");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { if (next) setCover(randomCover()); setOpen(next); setError(""); } }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Tạo môn học
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo môn học mới</DialogTitle>
          <DialogDescription>
            Đặt tên và thêm tài liệu cho môn học mới.
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
          {filteredKnownNames.length > 0 ? (
            <div>
              <p className="meta">
                Có vẻ trùng môn người khác đã tạo — bấm để dùng đúng tên đó.
              </p>
              <div className="scroll-chips" style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {filteredKnownNames.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={saving}
                    onClick={() => setName(suggestion)}
                    className="pill pill-grey"
                    style={{ cursor: "pointer" }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
          <CoverPicker value={cover} onChange={setCover} disabled={saving} />
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
