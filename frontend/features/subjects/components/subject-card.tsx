import { MessageCircle } from "lucide-react";
import type { Subject } from "@/features/subjects/types";

type SubjectCardProps = {
  subject: Subject;
  onOpen: (id: string) => void;
  /** Omitted where the cover should only open the subject (Hôm nay). */
  onAskTutor?: (id: string) => void;
};

function countLabel({ documentCount, quizCount }: Subject) {
  const parts = [
    documentCount ? `${documentCount} tài liệu` : "",
    quizCount ? `${quizCount} quiz` : "",
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return documentCount === 0 ? "Chưa có tài liệu" : "";
}

// A subject is a notebook: cover color, name written on the label. The whole
// cover opens it; "Hỏi AI" sits on top as its own button.
export function SubjectCard({ subject, onOpen, onAskTutor }: SubjectCardProps) {
  const counts = countLabel(subject);
  return (
    <article className={`subject-card cover-${subject.accent}`}>
      <button type="button" className="cover-open" onClick={() => onOpen(subject.id)} aria-label={`Mở môn ${subject.name}`} />
      <div className="nhan-vo">
        <h3 className="name">{subject.name}</h3>
      </div>
      <p className="desc">{subject.description}</p>
      <div className="card-foot">
        {counts ? <span className="count-chip">{counts}</span> : null}
        {onAskTutor ? (
          <button
            type="button"
            onClick={() => onAskTutor(subject.id)}
            className="cover-btn"
            aria-label={`Hỏi AI về ${subject.name}`}
          >
            <MessageCircle className="size-4" aria-hidden="true" /> Hỏi AI
          </button>
        ) : null}
      </div>
    </article>
  );
}
