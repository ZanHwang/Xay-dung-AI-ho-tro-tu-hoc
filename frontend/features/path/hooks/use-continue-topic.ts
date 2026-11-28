"use client";

import { useCallback, useEffect, useState } from "react";
import { pathApi, type TopicProgress } from "../services/path-api";

/** How many subjects are looked at before giving up. */
const MAX_SUBJECTS = 3;

export type ContinueTopic = {
  subjectId: string;
  documentId: string;
  documentName: string;
  /** The topic marked "current" in that document's Lộ trình. */
  topic: string;
  /** Every topic of the same document, in learning order. */
  topics: TopicProgress[];
};

/**
 * The topic to continue: walks the given subjects (most recently used first)
 * and returns the first one whose Lộ trình has a topic marked "current".
 * Best-effort - a failure just means nothing to show.
 */
export function useContinueTopic(subjectIds: string[]) {
  const key = subjectIds.slice(0, MAX_SUBJECTS).join(",");
  const [found, setFound] = useState<{ key: string; topic: ContinueTopic | null }>({ key: "", topic: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    async function look() {
      for (const subjectId of key.split(",")) {
        const groups = await pathApi.topics(subjectId).catch(() => []);
        if (disposed) return;
        for (const group of groups) {
          const current = group.topics.find((item) => item.state === "current");
          if (current) {
            const { documentId, documentName, topics } = group;
            setFound({ key, topic: { subjectId, documentId, documentName, topic: current.topic, topics } });
            return;
          }
        }
      }
      setFound({ key, topic: null });
    }
    void look();
    return () => { disposed = true; };
  }, [key, version]);

  /** Look again, e.g. after a practice quiz may have unlocked the next topic. */
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return { topic: found.key === key ? found.topic : null, reload };
}
