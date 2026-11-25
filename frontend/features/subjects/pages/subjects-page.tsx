import { CreateSubjectDialog } from "@/features/subjects/components/create-subject-dialog";
import { SubjectCard } from "@/features/subjects/components/subject-card";
import { SubjectDetail } from "@/features/subjects/components/subject-detail";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import type {
  CreateSubjectInput,
  Subject,
} from "@/features/subjects/types";

type SubjectsPageProps = {
  quizzes: QuizController;
  subjects: Subject[];
  selectedSubject?: Subject;
  onOpen: (id: string) => void;
  onBack: () => void;
  onAskTutor: (id: string) => void;
  onCreate: (input: CreateSubjectInput, files: File[]) => Promise<unknown>;
  onUpdate: (id: string, data: { name?: string; description?: string }) => Promise<void>;
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

  return (
    <div>
      <div className="view-head row-between">
        <div>
          <p className="label" style={{ color: "var(--accent-strong)" }}>Thư viện kiến thức</p>
          <h2 className="mt-1">Môn học của tôi</h2>
          <p className="sub">Tổ chức tài liệu, chủ đề và tiến độ theo từng môn học.</p>
        </div>
        <CreateSubjectDialog onCreate={onCreate} />
      </div>
      {subjects.length === 0 ? (
        <div className="empty">
          <h3>Chưa có môn học nào</h3>
          <p>Tạo môn học đầu tiên và đẩy tài liệu lên để bắt đầu.</p>
          <CreateSubjectDialog onCreate={onCreate} />
        </div>
      ) : (
        <div className="subject-grid">
          {subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} onOpen={onOpen} onAskTutor={onAskTutor} />
          ))}
        </div>
      )}
    </div>
  );
}
