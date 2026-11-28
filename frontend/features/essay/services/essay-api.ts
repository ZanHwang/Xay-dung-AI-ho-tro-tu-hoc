import { httpClient } from "@/services/http-client";

// =============================================================================
// Essay (bài tự luận) API client - ported from tu-hoc-rag-v2.
// =============================================================================

export interface EssayScore {
  criterion: string;
  score: number;
  max: number;
  quote?: string;
  feedback?: string;
}

export interface EssayGrade {
  essay_id: string;
  scores: EssayScore[];
  total: number;
  max_total: number;
  overall: string;
  mode: "llm" | "calculation" | "fallback";
  progress?: {
    xp: number;
    gems: number;
    hearts: number;
    streak: number;
  };
}

export interface Essay {
  id: string;
  subject_id: string | null;
  class_id: string | null;
  prompt: string;
  rubric: unknown;
  essay: string;
  total: number | null;
  max_total: number | null;
  feedback: unknown;
  status: "pending" | "graded";
  created_at: string;
}

export interface GradeInput {
  prompt: string;
  // Accept [{criterion, max}] or a multi-line string ("Ý 1 - 2đ\nÝ 2 - 3đ").
  rubric: unknown;
  essay: string;
  subject_id?: string | null;
  class_id?: string | null;
}

export const essayApi = {
  /** Grade a single essay against a barem (rubric). */
  async grade(input: GradeInput): Promise<EssayGrade> {
    return httpClient.post<EssayGrade>("/essays/grade", {
      prompt: input.prompt,
      rubric: input.rubric,
      essay: input.essay,
      subject_id: input.subject_id ?? null,
      class_id: input.class_id ?? null,
    });
  },

  /** The user's graded essays, newest first. */
  async list(): Promise<{ total: number; essays: Essay[] }> {
    return httpClient.get<{ total: number; essays: Essay[] }>("/essays/");
  },
};
