import { useState } from "react";
import { Check, Lock } from "lucide-react";
import type { ContinueTopic } from "@/features/path/hooks/use-continue-topic";
import type { Subject } from "@/features/subjects/types";

/** How many topics fit on the road at once. */
const WINDOW = 5;

type Props = {
  /** The road of "Học tiếp" first, then the other documents that still have a topic to learn. */
  roads: ContinueTopic[];
  subjects: Subject[];
  onOpenPath: (subjectId: string) => void;
};

/** One document's Lộ trình as a short road, centred on the topic being
 * learned; with several documents in progress, a row to switch between them. */
export function LearningRoad({ roads, subjects, onOpenPath }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const road = roads.find((item) => item.documentId === picked) ?? roads[0];
  if (!road) return null;

  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name;
  const current = road.topics.findIndex((item) => item.state === "current");
  const start = Math.max(0, Math.min(current - 2, road.topics.length - WINDOW));
  const shown = road.topics.slice(start, start + WINDOW);
  const where = [subjectName(road.subjectId), road.documentName].filter(Boolean).join(" · ");

  return (
    <section className="dash-block" aria-labelledby="dash-road">
      <div className="block-head">
        <h2 id="dash-road" className="block-title">Lộ trình đang học</h2>
        <span className="sub">{where}</span>
        <button type="button" className="link-btn" onClick={() => onOpenPath(road.subjectId)}>
          Mở lộ trình
        </button>
      </div>
      {roads.length > 1 ? (
        <div className="choices road-pick" role="group" aria-label="Chọn lộ trình để xem">
          {roads.map((item, index) => (
            <button
              key={item.documentId}
              type="button"
              className="choice"
              aria-pressed={item.documentId === road.documentId}
              title={[subjectName(item.subjectId), item.documentName].filter(Boolean).join(" · ")}
              onClick={() => setPicked(item.documentId)}
            >
              {index === 0 ? `Học tiếp: ${item.documentName}` : item.documentName}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="road">
        {shown.map((item, index) => (
          <li key={item.topic} className={`stop ${item.state}`}>
            <i aria-hidden="true">
              {item.state === "done" ? <Check className="size-5" /> : item.state === "locked" ? <Lock className="size-4" /> : start + index + 1}
            </i>
            <b>{item.topic}</b>
            <small>
              {item.state === "done" ? `đạt ${item.bestPercent}%` : item.state === "current" ? "đang học" : "đang khóa"}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
