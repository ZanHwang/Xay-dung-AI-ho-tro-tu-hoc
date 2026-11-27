import { ArrowUpRight, MessageCircle } from "lucide-react";
import type { Subject } from "@/features/subjects/types";

type SubjectCardProps = {
  subject: Subject;
  onOpen: (id: string) => void;
  onAskTutor: (id: string) => void;
};

// v2 element order: icon -> h3 -> p -> actions. Action buttons are a
// deliberate addition over the v2 reference (which makes the whole card one
// click target with no secondary actions) so existing "Hỏi Tutor" shortcut
// stays.
export function SubjectCard({ subject, onOpen, onAskTutor }: SubjectCardProps) {
  return (
    <article className="subject-card group">
      <span className={`subj-ic subj-${subject.accent}`}>{subject.shortName}</span>
      <h3>{subject.name}</h3>
      <p>{subject.description}</p>
      <div className="mt-auto pt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAskTutor(subject.id)}
          className="btn btn-ghost btn-sm"
          aria-label={`Hỏi AI Tutor về ${subject.name}`}
        >
          <MessageCircle className="size-4" /> Hỏi Tutor
        </button>
        <button
          type="button"
          onClick={() => onOpen(subject.id)}
          className="btn btn-outline btn-sm ml-auto flex items-center gap-1"
        >
          Mở môn học <ArrowUpRight className="size-4" />
        </button>
      </div>
    </article>
  );
}
