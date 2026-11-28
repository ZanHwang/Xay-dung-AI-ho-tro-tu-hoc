import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { CreateSubjectDialog } from "@/features/subjects/components/create-subject-dialog";
import { SubjectCard } from "@/features/subjects/components/subject-card";
import { SubjectDetail, type SubjectTab } from "@/features/subjects/components/subject-detail";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import {
  byRecentUse,
  searchKey,
  type CreateSubjectInput,
  type Subject,
  type UpdateSubjectInput,
} from "@/features/subjects/types";

/** From this many subjects on, the list gets a search box. */
const SEARCH_FROM = 9;

type SubjectsPageProps = {
  quizzes: QuizController;
  subjects: Subject[];
  selectedSubject?: Subject;
  initialTab?: SubjectTab;
  /** Where the open subject's back button leads, e.g. "Hôm nay". */
  backLabel: string;
  onOpen: (id: string) => void;
  /** Leaves the open subject. */
  onBack: () => void;
  /** Leaves the list, back to Hôm nay. */
  onHome: () => void;
  onAskTutor: (id: string) => void;
  onCreate: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  onUpdate: (id: string, data: UpdateSubjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function SubjectsPage({
  subjects,
  selectedSubject,
  initialTab,
  backLabel,
  onOpen,
  onBack,
  onHome,
  onCreate,
  onAskTutor,
  onUpdate,
  onDelete,
  quizzes,
}: SubjectsPageProps) {
  const [query, setQuery] = useState("");

  if (selectedSubject) {
    return (
      <SubjectDetail
        subject={selectedSubject}
        initialTab={initialTab}
        backLabel={backLabel}
        onBack={onBack}
        onAskTutor={onAskTutor}
        onUpdate={onUpdate}
        onDelete={async (id) => {
          await onDelete(id);
          onBack();
        }}
        quizzes={quizzes}
      />
    );
  }

  const newNotebook = (
    <CreateSubjectDialog
      onCreate={onCreate}
      trigger={
        <button type="button" className="cover-new">
          <Plus className="size-7" aria-hidden="true" />
          Tạo môn học
        </button>
      }
    />
  );

  const searchable = subjects.length >= SEARCH_FROM;
  const wanted = searchable ? searchKey(query) : "";
  const shown = byRecentUse(subjects).filter((subject) => !wanted || searchKey(subject.name).includes(wanted));

  return (
    <div className="page">
      <button type="button" onClick={onHome} className="link-btn mb-3 gap-2">
        <ArrowLeft className="size-4" aria-hidden="true" /> Hôm nay
      </button>
      <div className="view-head">
        <h1>Môn học</h1>
        <p>
          {subjects.length === 0
            ? "Chưa có môn nào. Tạo môn đầu tiên rồi thêm tài liệu để bắt đầu."
            : "Mỗi môn là một quyển vở: tài liệu, lộ trình và quiz nằm bên trong. Môn học gần nhất đứng đầu."}
        </p>
      </div>
      {searchable ? (
        <div className="list-search">
          <input
            type="search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm môn theo tên"
            aria-label="Tìm môn theo tên"
          />
          {wanted ? <p className="meta" role="status">{shown.length ? `${shown.length} môn khớp` : "Không có môn nào khớp."}</p> : null}
        </div>
      ) : null}
      <div className="subject-grid">
        {shown.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} onOpen={onOpen} onAskTutor={onAskTutor} />
        ))}
        {wanted ? null : newNotebook}
      </div>
    </div>
  );
}
