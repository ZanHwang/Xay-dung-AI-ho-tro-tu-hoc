import { ArrowLeft, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { accentToColor, type Subject, type SubjectAccent, type UpdateSubjectInput } from "@/features/subjects/types";
import { CoverPicker } from "./cover-picker";
import { SubjectDocuments } from "./subject-documents";
import { SubjectQuizSummary } from "@/features/quiz/components/subject-quiz-summary";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import { PathTab } from "@/features/path/components/path-tab";

type SubjectDetailProps = {
  quizzes: QuizController;
  subject: Subject;
  onBack: () => void;
  onAskTutor: (id: string) => void;
  onUpdate: (id: string, data: UpdateSubjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type TabKey = "documents" | "quiz" | "path";

const TABS: { key: TabKey; label: string }[] = [
  { key: "documents", label: "Tài liệu" },
  { key: "path", label: "Lộ trình" },
  { key: "quiz", label: "Quiz" },
];

// The subject's notebook cover heads the page; its index tabs switch between
// Tài liệu | Lộ trình | Quiz. Each document row in SubjectDocuments has its own
// "Đọc" button, so there is no separate reading tab.
export function SubjectDetail({ subject, onBack, onAskTutor, onUpdate, onDelete, quizzes }: SubjectDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("documents");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(subject.name);
  const [editDescription, setEditDescription] = useState(subject.description ?? "");
  const [editCover, setEditCover] = useState<SubjectAccent>(subject.accent);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState("");

  async function handleSave() {
    if (!editName.trim() || saving) return;
    setSaving(true);
    setEditError("");
    try {
      await onUpdate(subject.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        color: editCover !== subject.accent ? accentToColor(editCover) : undefined,
      });
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Không thể cập nhật môn học.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(subject.id);
      // onDelete will navigate back, no need to do anything else
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Không thể xóa môn học.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="page">
      <button type="button" onClick={onBack} className="link-btn mb-3 gap-2">
        <ArrowLeft className="size-4" aria-hidden="true" /> Tất cả môn học
      </button>

      <div className={`subj-cover cover-${subject.accent}`}>
        <div className="subj-head">
          <div className="nhan-vo">
            <h2 className="name">{subject.name}</h2>
            {subject.description ? <p>{subject.description}</p> : null}
          </div>
          <div className="subj-actions">
            <button type="button" className="cover-btn solid" onClick={() => onAskTutor(subject.id)}>
              <MessageCircle className="size-4" aria-hidden="true" /> Hỏi AI về môn này
            </button>
            <button
              type="button"
              className="cover-btn"
              onClick={() => {
                setEditName(subject.name);
                setEditDescription(subject.description ?? "");
                setEditCover(subject.accent);
                setEditError("");
                setEditing(true);
              }}
              aria-label={`Sửa môn học ${subject.name}`}
            >
              <Pencil className="size-4" aria-hidden="true" /> Sửa
            </button>
            <button
              type="button"
              className="cover-btn"
              onClick={() => {
                setEditError("");
                setConfirmDelete(true);
              }}
              aria-label={`Xóa môn học ${subject.name}`}
            >
              <Trash2 className="size-4" aria-hidden="true" /> Xóa
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Nội dung môn học" className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="tab"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tabpanel" role="tabpanel">
        {activeTab === "documents" && (
          <div key={`docs-${subject.id}`}>
            <SubjectDocuments subjectId={subject.id} />
          </div>
        )}
        {activeTab === "quiz" && (
          <div key={`quiz-${subject.id}`}>
            <SubjectQuizSummary subject={subject} quizzes={quizzes} />
          </div>
        )}
        {activeTab === "path" && (
          <div key={`path-${subject.id}`}>
            <PathTab subjectId={subject.id} quizzes={quizzes} />
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editing} onOpenChange={(next) => { if (!saving) setEditing(next); }}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa môn học</DialogTitle>
            <DialogDescription>Đổi tên, mô tả hoặc màu bìa của môn học.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="field">
                Tên môn học
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Ví dụ: Toán Cao Cấp"
                  className="input"
                  disabled={saving}
                  aria-label="Tên môn học"
                />
              </label>
            </div>
            <div>
              <label className="field">
                Mô tả
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Mô tả ngắn về môn học"
                  className="input"
                  disabled={saving}
                  aria-label="Mô tả môn học"
                />
              </label>
            </div>
            <CoverPicker value={editCover} onChange={setEditCover} disabled={saving} />
            {editError ? (
              <div className="error-box">
                <p>{editError}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Hủy</Button>
            <Button onClick={handleSave} disabled={!editName.trim() || saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={confirmDelete} onOpenChange={(next) => { if (!deleting) setConfirmDelete(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xóa môn học?</DialogTitle>
            <DialogDescription>
              Môn học &quot;{subject.name}&quot; và toàn bộ tài liệu, chủ đề, quiz, hội thoại liên quan sẽ bị xóa. Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          {editError ? (
            <div className="error-box">
              <p>{editError}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Hủy</Button>
            <Button onClick={handleDelete} disabled={deleting} variant="destructive">
              {deleting ? "Đang xóa..." : "Xóa môn học"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
