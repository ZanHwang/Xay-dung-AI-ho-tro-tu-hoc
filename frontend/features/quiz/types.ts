// =============================================================================
// Frontend Types (aligned with backend)
// =============================================================================

export type QuizDifficulty = "easy" | "medium" | "hard";

export type QuizQuestion = {
  id: string;
  topic: string;
  difficulty: QuizDifficulty;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  // This question's own Lộ trình topic from the backend (QuizQuestion.topic),
  // unlike `topic` above (always "Tổng hợp" - client-side mastery grouping,
  // unrelated). null/undefined when the backend couldn't attribute one.
  // Used only to offer "Xem lại kiến thức" on a wrong answer.
  backendTopic?: string | null;
};

export type Quiz = {
  id: string;
  // backendId: the backend Quiz UUID when this quiz was created on the server
  // (shared/ai/wrong/review). Needed so submitting actually persists the
  // result; local-only quizzes leave this undefined.
  backendId?: string;
  subjectId: string;
  title: string;
  difficulty?: QuizDifficulty;
  adaptive?: boolean;
  createdAt: string;
  totalQuestions?: number;
  questions: QuizQuestion[];
  conversationId?: string | null;
  // Set only for a quiz scoped to one specific document's own Lộ trình
  // topic (create_next_quiz(document_id=...)) - lets "Xem lại kiến thức" on
  // a wrong answer open that exact document's lesson. null/undefined for
  // "Tổng hợp" or any quiz not tied to one document.
  documentId?: string | null;
  // "review" = spaced-repetition quiz built from questions whose review date
  // has come due (created via /quizzes/from-review). "weakness" is kept only
  // so quiz-store.ts can still read old quizzes saved before "Chủ đề" was
  // removed — nothing creates it anymore.
  source?: "sample" | "api" | "shared" | "weakness" | "wrong" | "review";
};

export type QuizDraft = { id: string; quizId: string; startedAt: string; answers: Record<string, number> };
// backendResultId: id of the backend QuizResult created when an "api" quiz
// was submitted through the backend - needed for "retry wrong answers".
export type QuizAttempt = QuizDraft & { submittedAt: string; backendResultId?: string };
export type TopicMastery = { subjectId: string; topic: string; correct: number; total: number; percent: number | null };

// =============================================================================
// Backend API Types
// =============================================================================

export interface ApiQuiz {
  id: string;
  user_id: string;
  subject_id: string;
  document_id?: string;
  title: string;
  difficulty: QuizDifficulty;
  source?: string;
  total_questions?: number;
  created_at: string;
}

export interface ApiQuizQuestion {
  id: string;
  quiz_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
  explanation?: string;
  topic?: string | null;
  created_at: string;
}

export interface ApiQuizWithQuestions extends ApiQuiz {
  questions: ApiQuizQuestion[];
}

export interface QuizListResponse {
  total: number;
  quizzes: ApiQuiz[];
}

export interface QuizAnswer {
  question_id: string;
  selected_answer: number;
}

export interface QuizSubmit {
  answers: QuizAnswer[];
  time_spent?: number;
}

export interface QuizAnswerResponse {
  question_id: string;
  selected_answer?: number;
  is_correct: boolean;
  correct_answer: number;
  explanation?: string;
  time_spent?: number;
  used_hint: boolean;
}

export interface QuizResultResponse {
  id: string;
  quiz_id: string;
  score: number;
  total_questions: number;
  correct_count: number;
  created_at: string;
  answers: QuizAnswerResponse[];
}

export interface QuizResultListResponse {
  total: number;
  results: QuizResultResponse[];
}

export interface QuizCreateRequest {
  subject_id: string;
  document_id?: string;
  document_ids?: string[];
  num_questions?: number;
  difficulty?: QuizDifficulty;
}
