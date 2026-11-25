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
import type { Subject } from "@/features/subjects/types";
import { SubjectDocuments } from "./subject-documents";
import { SubjectQuizSummary } from "@/features/quiz/components/subject-quiz-summary";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import { PathTab } from "@/features/path/components/path-tab";

type SubjectDetailProps = {
  quizzes: QuizController;
  subject: Subject;
  onBack: () => void;
  onAskTutor: (id: string) => void;
  onUpdate: (id: string, data: { name?: string; description?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type TabKey = "documents" | "quiz" | "path";

const TABS: { key: TabKey; label: string }[] = [
  { key: "documents", label: "Tài liệu" },
  { key: "quiz", label: "Quiz" },
  { key: "path", label: "Lộ trình" },
];

// v2 layout: the subject detail is tabbed (Tài liệu | Quiz | Lộ trình)
// instead of a long vertical stack. The "Đọc" tab was removed — each
// document row in SubjectDocuments already has its own "Đọc" button.
export function SubjectDetail({ subject, onBack, onAskTutor, onUpdate, onDelete, quizzes }: SubjectDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("documents");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(subject.name);
  const [editDescription, setEditDescription] = useState(subject.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState("");

  async function handleSave() {
    if (!editName.trim() || saving) return;
    setSaving(true);
    setEditError("");
    try {
      await onUpdate(subject.id, { name: editName.trim(), description: editDescription.trim() });
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
    <div>
      <button
        type="button"
        onClick={onBack}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 16, color: "var(--muted)" }}
      >
        <ArrowLeft /> Quay lại danh sách
      </button>

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--surface)" }}>
        <div className="subj-head">
          <div className="row-between">
            <div className="flex items-start gap-4">
              <span className={`subj-ic subj-${subject.accent}`} style={{ width: 56, height: 56, fontSize: 18, marginBottom: 0 }}>
                {subject.shortName}
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>{subject.name}</h2>
                <p className="sub" style={{ marginTop: 8, maxWidth: "36ch" }}>{subject.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={() => {
                  setEditName(subject.name);
                  setEditDescription(subject.description ?? "");
                  setEditError("");
                  setEditing(true);
                }}
                variant="outline"
                size="sm"
                aria-label={`Sửa môn học ${subject.name}`}
              >
                <Pencil /> Sửa
              </Button>
              <Button
                onClick={() => {
                  setEditError("");
                  setConfirmDelete(true);
                }}
                variant="outline"
                size="sm"
                style={{ color: "var(--error)", borderColor: "var(--error)" }}
                aria-label={`Xóa môn học ${subject.name}`}
              >
                <Trash2 /> Xóa
              </Button>
            </div>
          </div>
          <Button onClick={() => onAskTutor(subject.id)} className="btn-accent" style={{ marginTop: 20 }}>
            <MessageCircle /> Hỏi AI Tutor về môn này
          </Button>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Nội dung môn học" className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="tab"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tabpanel">
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
      </div>

      {/* Edit dialog */}
      <Dialog open={editing} onOpenChange={(next) => { if (!saving) setEditing(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa môn học</DialogTitle>
            <DialogDescription>Đổi tên hoặc mô tả cho môn học.</DialogDescription>
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
