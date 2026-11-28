import type { QuizAttempt } from "@/features/quiz/types";

const LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Quiz submissions per day of the current week (Monday first). */
export function weekCounts(submittedAt: string[], now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const days = LABELS.map((label, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return { label, key: date.toDateString(), today: date.toDateString() === now.toDateString(), count: 0 };
  });
  for (const value of submittedAt) {
    const day = days.find((item) => item.key === new Date(value).toDateString());
    if (day) day.count += 1;
  }
  return days;
}

export function WeekActivity({ attempts }: { attempts: QuizAttempt[] }) {
  const days = weekCounts(attempts.map((attempt) => attempt.submittedAt));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const active = days.filter((day) => day.count > 0).length;

  return (
    <section className="dash-block week-block" aria-labelledby="dash-week">
      <div className="block-head">
        <h2 id="dash-week" className="block-title">Tuần này</h2>
        <span className="sub">{total ? `${total} bài quiz trong ${active} ngày` : "Chưa làm bài quiz nào"}</span>
      </div>
      <ul className="days-row">
        {days.map((day) => (
          <li key={day.key} className={`day${day.count === 1 ? " did" : day.count > 1 ? " busy" : ""}${day.today ? " today" : ""}`}>
            <span>{day.label}</span>
            <i aria-hidden="true">{day.count || ""}</i>
            <span className="sr-only">{day.count} bài{day.today ? ", hôm nay" : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
