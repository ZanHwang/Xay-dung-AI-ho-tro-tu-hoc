import { httpClient } from "@/services/http-client";
import type { ResultRow } from "@/features/dashboard/services/dashboard-store";

export const gradesApi = {
  /** Every quiz submission, newest first, optionally of one subject. */
  async results(params: { subjectId?: string; limit: number; offset: number }): Promise<{ total: number; results: ResultRow[] }> {
    const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.subjectId) search.set("subject_id", params.subjectId);
    return httpClient.get(`/progress/results?${search}`);
  },
};
