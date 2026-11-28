"use client";

import { useCallback, useEffect, useState } from "react";
import { pathApi, type ContinueHome, type ContinueTopic } from "../services/path-api";

export type { ContinueHome, ContinueTopic };

/**
 * The topic to continue and the other roads, chosen by the server across
 * all subjects. null until loaded, or when the server can't say (an older
 * server, a network error) - then Hôm nay simply shows neither.
 */
export function useContinueTopic() {
  const [home, setHome] = useState<ContinueHome | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
    pathApi.continueTopic()
      .then((found) => { if (!disposed) setHome(found); })
      .catch(() => { if (!disposed) setHome(null); });
    return () => { disposed = true; };
  }, [version]);

  /** Look again, e.g. after a practice quiz may have unlocked the next topic. */
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return { home, reload };
}
