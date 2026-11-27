import { httpClient } from "@/services/http-client";

// =============================================================================
// Spaced-repetition "câu đến hạn ôn" API client - split out of the removed
// gamification feature (unrelated: based on the Review table, not XP/hearts).
// =============================================================================

export interface DueQuizSummary {
  quiz_id: string;
  title: string;
  subject_id: string | null;
  due_count: number;
}

export const reviewApi = {
  /** Quizzes that currently have at least one due question, grouped with a
   * count each ("Học tiếp" card / header bell, and the due-review popup). */
  async dueQuizzes(): Promise<{ total: number; quizzes: DueQuizSummary[] }> {
    return httpClient.get<{ total: number; quizzes: DueQuizSummary[] }>(
      `/progress/reviews/due-quizzes`,
    );
  },
};
