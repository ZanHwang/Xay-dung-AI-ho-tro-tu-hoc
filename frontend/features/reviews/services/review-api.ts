import { httpClient } from "@/services/http-client";

// =============================================================================
// Spaced-repetition "câu đến hạn ôn" API client - split out of the removed
// gamification feature (unrelated: based on the Review table, not XP/hearts).
// =============================================================================

export interface ReviewDueQuestion {
  question_id: string;
  question_text: string;
  options: string; // JSON array of choice strings
  due_date: string;
  interval_days: number;
}

export const reviewApi = {
  /** Spaced-repetition questions due today ("Học tiếp" card / header bell). */
  async dueReviews(limit = 20): Promise<{ total: number; questions: ReviewDueQuestion[] }> {
    return httpClient.get<{ total: number; questions: ReviewDueQuestion[] }>(
      `/progress/reviews/due?limit=${limit}`,
    );
  },
};
