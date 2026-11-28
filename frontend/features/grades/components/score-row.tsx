import type { ResultRow } from "@/features/dashboard/services/dashboard-store";
import type { Subject } from "@/features/subjects/types";

/** "dd/mm" of a backend timestamp (UTC without a "Z"), in local time. */
export function dayMonth(value: string | Date) {
  const date = typeof value === "string"
    ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
    : value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

type Props = {
  row: ResultRow;
  subject?: Subject;
  busy?: boolean;
  onOpen: (row: ResultRow) => void;
};

/** One submission in Sổ điểm: quiz, subject and day, and the score - or, for
 * a review of a few questions, how many of them were right. */
export function ScoreRow({ row, subject, busy, onOpen }: Props) {
  const date = dayMonth(row.created_at);
  const answered = row.total_questions ?? 0;
  return (
    <button type="button" onClick={() => onOpen(row)} className="row-link" aria-busy={busy || undefined}>
      <span className={`spine-dot ${subject ? `cover-${subject.accent}` : ""}`} aria-hidden="true" />
      <span className="grow">
        <span className="title">{row.title ?? "Quiz"}</span>
        <span className="sub2">{busy ? "Đang mở…" : subject ? `${subject.name}, ngày ${date}` : `Làm ngày ${date}`}</span>
      </span>
      {row.partial ? (
        <span className="score-note">Ôn {answered} câu: đúng {row.correct_count ?? 0}/{answered}</span>
      ) : (
        <span className="score-pen"><span className="sr-only">Đạt </span>{Math.round(row.score)}%</span>
      )}
    </button>
  );
}
