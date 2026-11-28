import { MessageCircle } from "lucide-react";
import type { Subject } from "@/features/subjects/types";

type SubjectCardProps = {
  subject: Subject;
  onOpen: (id: string) => void;
  /** Omitted where the cover should only open the subject (Tổng quan). */
  onAskTutor?: (id: string) => void;
};

// A subject is a notebook: cover color, name written on the label. The whole
// cover opens it; "Hỏi AI" sits on top as its own button.
export function SubjectCard({ subject, onOpen, onAskTutor }: SubjectCardProps) {
  return (
    <article className={`subject-card cover-${subject.accent}`}>
      <button type="button" className="cover-open" onClick={() => onOpen(subject.id)} aria-label={`Mở môn ${subject.name}`} />
      <div className="nhan-vo">
        <h3 className="name">{subject.name}</h3>
      </div>
      <p className="desc">{subject.description}</p>
      {onAskTutor ? (
        <button
          type="button"
          onClick={() => onAskTutor(subject.id)}
          className="cover-btn mt-auto self-start"
          aria-label={`Hỏi AI Tutor về ${subject.name}`}
        >
          <MessageCircle className="size-4" aria-hidden="true" /> Hỏi AI
        </button>
      ) : null}
    </article>
  );
}
