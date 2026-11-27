import { httpClient } from "@/services/http-client";
import {
  type Quiz,
  type QuizQuestion,
  type QuizDifficulty,
  type ApiQuiz,
  type ApiQuizQuestion,
  type ApiQuizWithQuestions,
  type QuizListResponse,
  type QuizSubmit,
  type QuizResultResponse,
  type QuizResultListResponse,
  type QuizCreateRequest,
} from "../types";

// =============================================================================
// Map Backend to Frontend
// =============================================================================

export function mapQuizQuestion(api: ApiQuizQuestion): QuizQuestion {
  return {
    id: api.id,
    // "Chủ đề" (Topic) was removed from the backend; the client-side mastery
    // grouping (quiz-engine.ts) just buckets everything under one label now.
    topic: "Tổng hợp",
    difficulty: "medium" as QuizDifficulty, // Default, backend has difficulty per quiz
    prompt: api.question_text,
    options: api.options,
    correctIndex: api.correct_answer,
    explanation: api.explanation?.trim() || "Tham khảo lại nội dung liên quan trong tài liệu.",
    backendTopic: api.topic ?? null,
    backendLastCorrect: api.last_correct ?? null,
  };
}

function sourceOf(apiSource: string | undefined): Quiz["source"] {
  if (apiSource === "wrong" || apiSource === "review") return apiSource;
  return apiSource ? "api" : "sample";
}

export function mapQuiz(api: ApiQuiz, questions: QuizQuestion[] = []): Quiz {
  return {
    id: api.id,
    // Quiz created on the server (backend UUID) - submit/retry must use this
    // id, not the local store id.
    backendId: api.id,
    // Review quizzes may be cross-subject (subject_id null) - fall back to ""
    // so the store's required subjectId stays a string; the caller picks a
    // subject when it must.
    subjectId: api.subject_id ?? "",
    title: api.title,
    difficulty: api.difficulty,
    createdAt: api.created_at,
    totalQuestions: api.total_questions,
    questions,
    conversationId: api.document_id ?? null,
    documentId: api.document_id ?? null,
    source: sourceOf(api.source),
  };
}

// =============================================================================
// Quiz API Service
// =============================================================================

export const quizApi = {
  /**
   * List quizzes, optionally filtered by subject
   */
  async list(params?: {
    subject_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; quizzes: Quiz[] }> {
    const searchParams = new URLSearchParams();
    if (params?.subject_id) searchParams.set("subject_id", params.subject_id);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());

    const query = searchParams.toString();
    const url = `/quizzes/${query ? `?${query}` : ""}`;

    const response: QuizListResponse = await httpClient.get(url);

    return {
      total: response.total,
      quizzes: response.quizzes.map((q) => mapQuiz(q)),
    };
  },

  /**
   * Every quiz of the user, with its questions - unlike `list()`, which
   * returns a lightweight summary with no questions. Used to rebuild full
   * quiz history on a device/browser that doesn't have it locally yet.
   */
  async listFull(): Promise<{ total: number; quizzes: Quiz[] }> {
    const response: { total: number; quizzes: ApiQuizWithQuestions[] } = await httpClient.get("/quizzes/full?limit=200");
    return {
      total: response.total,
      quizzes: response.quizzes.map((q) => mapQuiz(q, q.questions.map(mapQuizQuestion))),
    };
  },

  /**
   * Get quiz with questions
   */
  async get(id: string): Promise<Quiz> {
    const api: ApiQuizWithQuestions = await httpClient.get(`/quizzes/${id}`);
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },

  /**
   * Create a new quiz (AI-generated questions)
   */
  async create(data: QuizCreateRequest): Promise<Quiz> {
    const payload = {
      subject_id: data.subject_id,
      document_id: data.document_id ?? null,
      document_ids: data.document_ids ?? null,
      num_questions: data.num_questions ?? 10,
      difficulty: data.difficulty ?? "medium",
    };

    const api: ApiQuizWithQuestions = await httpClient.post("/quizzes/", payload);
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },

  /**
   * Submit quiz answers and get results
   */
  async submit(
    quizId: string,
    answers: Record<string, number>,
    timeSpent?: number,
    questionIds?: string[]
  ): Promise<{
    id: string;
    quiz_id: string;
    score: number;
    total: number;
    correct_count: number;
    created_at: string;
    answers: Array<{
      question_id: string;
      selected_answer?: number;
      is_correct: boolean;
      correct_answer: number;
      explanation?: string;
    }>;
  }> {
    const submission: QuizSubmit = {
      answers: Object.entries(answers).map(([question_id, selected_answer]) => ({
        question_id,
        selected_answer,
      })),
      time_spent: timeSpent,
      question_ids: questionIds,
    };

    const result: QuizResultResponse = await httpClient.post(
      `/quizzes/${quizId}/submit`,
      submission
    );

    return {
      id: result.id,
      quiz_id: result.quiz_id,
      score: result.score,
      total: result.total_questions,
      correct_count: result.correct_count,
      created_at: result.created_at,
      answers: result.answers.map((a) => ({
        question_id: a.question_id,
        selected_answer: a.selected_answer,
        is_correct: a.is_correct,
        correct_answer: a.correct_answer,
        explanation: a.explanation,
      })),
    };
  },

  /**
   * Get quiz results history
   */
  async getResults(
    quizId?: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ total: number; results: QuizResultResponse[] }> {
    let url: string;

    if (quizId) {
      url = `/quizzes/${quizId}/results`;
    } else {
      url = `/quizzes/history/results`;
    }

    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());

    const query = searchParams.toString();
    if (query) url += `?${query}`;

    const response: QuizResultListResponse = await httpClient.get(url);
    return {
      total: response.total,
      results: response.results,
    };
  },

  /**
   * Create a "next" quiz for a subject (shared bank + verified AI + dedup).
   */
  async createNext(data: {
    subject_id: string;
    topic?: string | null;
    all_knowledge?: boolean;
    num_questions?: number;
    difficulty?: string;
    document_id?: string | null;
  }): Promise<Quiz> {
    const payload = {
      subject_id: data.subject_id,
      topic: data.topic ?? null,
      all_knowledge: data.all_knowledge ?? false,
      num_questions: data.num_questions ?? 5,
      difficulty: data.difficulty ?? "medium",
      document_id: data.document_id ?? null,
    };
    const api: ApiQuizWithQuestions = await httpClient.post("/quizzes/create-next", payload);
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },

  /**
   * AI-suggested topics for a subject, derived from its READY documents.
   */
  async getSuggestedTopics(subjectId: string): Promise<string[]> {
    const response: { subject_id: string; topics: string[] } = await httpClient.get(
      `/quizzes/suggested-topics/?subject_id=${encodeURIComponent(subjectId)}`
    );
    return response.topics ?? [];
  },

  /**
   * Custom topics ("Chủ đề khác…") proven valid before - at least one
   * AI-verified question already exists for them in this subject's shared
   * bank (shared by subject NAME across users, same as the rest of the
   * bank). Independent of Lộ trình, which needs topics tied to one specific
   * document - this list is subject-wide and not tied to any document.
   */
  async getKnownTopics(subjectId: string): Promise<string[]> {
    const response: { subject_id: string; topics: string[] } = await httpClient.get(
      `/quizzes/known-topics/?subject_id=${encodeURIComponent(subjectId)}`
    );
    return response.topics ?? [];
  },

  /**
   * Delete a quiz on the backend (its questions/results cascade). Best-effort
   * callers should swallow failures — the quiz is already gone from the
   * local store either way.
   */
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/quizzes/${id}`);
  },

  /**
   * Rename a quiz on the backend - needed so anywhere that reads the title
   * straight from there (due-review popup, a different device's sync) stays
   * in sync, not just this browser's local store. Best-effort callers should
   * swallow failures — the local rename already took effect either way.
   */
  async rename(id: string, title: string): Promise<void> {
    await httpClient.patch(`/quizzes/${id}`, { title });
  },

  /**
   * Create a "retry wrong answers" quiz from a submitted backend result.
   */
  /**
   * Read-only: the questions failed in a past result, alongside their
   * ORIGINAL quiz - no new quiz is created. Submit the answers back to
   * `submit(quiz.backendId, answers, undefined, quiz.questions.map(q => q.id))`.
   */
  async retryWrong(resultId: string): Promise<Quiz> {
    const api: ApiQuizWithQuestions = await httpClient.get(`/quizzes/results/${resultId}/wrong-questions`);
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },

  /**
   * Read-only: one quiz's own questions whose review date has come due (see
   * backend QuizService.REVIEW_SCHEDULE) - no new quiz is created. 404 when
   * nothing of it is due yet. Submit the same way as retryWrong above.
   */
  async dueQuestions(quizId: string): Promise<Quiz> {
    const api: ApiQuizWithQuestions = await httpClient.get(`/quizzes/${quizId}/due-questions`);
    return mapQuiz(api, api.questions.map(mapQuizQuestion));
  },
};

// =============================================================================
// Demo/Mock Data (for development without backend)
// =============================================================================

const DEMO_QUESTIONS: QuizQuestion[] = [
  {
    id: "q1",
    topic: "Giải tích",
    difficulty: "easy",
    prompt: "Đạo hàm của f(x) = x² + 2x + 1 là gì?",
    options: ["2x + 2", "x² + 2", "2x + 1", "x + 2"],
    correctIndex: 0,
    explanation: "Sử dụng quy tắc đạo hàm: d(x²)/dx = 2x, d(2x)/dx = 2, d(1)/dx = 0",
  },
  {
    id: "q2",
    topic: "Giải tích",
    difficulty: "medium",
    prompt: "Tích phân ∫2x dx bằng?",
    options: ["x² + C", "2x² + C", "x + C", "2 + C"],
    correctIndex: 0,
    explanation: "∫2x dx = 2∫x dx = 2(x²/2) + C = x² + C",
  },
  {
    id: "q3",
    topic: "Giải tích",
    difficulty: "hard",
    prompt: "Giới hạn lim(x→0) sin(x)/x = ?",
    options: ["0", "1", "∞", "Không tồn tại"],
    correctIndex: 1,
    explanation: "Đây là giới hạn cơ bản, sử dụng quy tắc L'Hôpital hoặc định nghĩa Squeeze",
  },
];

const DEMO_QUIZ: Quiz = {
  id: "quiz-demo-1",
  subjectId: "demo-1",
  title: "Kiểm tra Giải tích - Đạo hàm",
  difficulty: "medium",
  createdAt: new Date().toISOString(),
  totalQuestions: 3,
  questions: DEMO_QUESTIONS,
  source: "sample",
};

/**
 * Get demo quiz (for development/fallback)
 */
export function getDemoQuiz(): Quiz {
  return DEMO_QUIZ;
}

/**
 * Get demo questions (for development/fallback)
 */
export function getDemoQuestions(): QuizQuestion[] {
  return DEMO_QUESTIONS;
}
