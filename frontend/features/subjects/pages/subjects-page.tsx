import { Plus } from "lucide-react";
import { CreateSubjectDialog } from "@/features/subjects/components/create-subject-dialog";
import { SubjectCard } from "@/features/subjects/components/subject-card";
import { SubjectDetail } from "@/features/subjects/components/subject-detail";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import type {
  CreateSubjectInput,
  Subject,
  UpdateSubjectInput,
} from "@/features/subjects/types";

type SubjectsPageProps = {
  quizzes: QuizController;
  subjects: Subject[];
  selectedSubject?: Subject;
  onOpen: (id: string) => void;
  onBack: () => void;
  onAskTutor: (id: string) => void;
  onCreate: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  onUpdate: (id: string, data: UpdateSubjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function SubjectsPage({
  subjects,
  selectedSubject,
  onOpen,
  onBack,
  onCreate,
  onAskTutor,
  onUpdate,
  onDelete,
  quizzes,
}: SubjectsPageProps) {
  if (selectedSubject) {
    return (
      <SubjectDetail
        subject={selectedSubject}
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
        <button type="button" className="cover-new oly">
          <Plus className="size-7" aria-hidden="true" />
          Tạo môn học
        </button>
      }
    />
  );

  return (
    <div className="page">
      <div className="view-head">
        <h2>Môn học của tôi</h2>
        <p>
          {subjects.length === 0
            ? "Chưa có môn nào. Tạo môn đầu tiên rồi thêm tài liệu để bắt đầu."
            : "Mỗi môn là một quyển vở: tài liệu, lộ trình và quiz nằm bên trong."}
        </p>
      </div>
      <div className="subject-grid">
        {subjects.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} onOpen={onOpen} onAskTutor={onAskTutor} />
        ))}
        {newNotebook}
      </div>
    </div>
  );
}
