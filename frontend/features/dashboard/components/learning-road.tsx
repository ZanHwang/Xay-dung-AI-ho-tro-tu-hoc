import { Check, Lock } from "lucide-react";
import type { ContinueTopic } from "@/features/path/hooks/use-continue-topic";

/** How many topics fit on the road at once. */
const WINDOW = 5;

type Props = { road: ContinueTopic; onOpenPath: () => void };

/** The current document's Lộ trình as a short road, centred on the topic being learned. */
export function LearningRoad({ road, onOpenPath }: Props) {
  const current = road.topics.findIndex((item) => item.state === "current");
  const start = Math.max(0, Math.min(current - 2, road.topics.length - WINDOW));
  const shown = road.topics.slice(start, start + WINDOW);

  return (
    <section className="dash-block" aria-labelledby="dash-road">
      <div className="block-head">
        <h2 id="dash-road" className="block-title">Lộ trình đang học</h2>
        <span className="sub">{road.documentName}</span>
        <button type="button" className="link-btn" onClick={onOpenPath}>
          Mở lộ trình
        </button>
      </div>
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
