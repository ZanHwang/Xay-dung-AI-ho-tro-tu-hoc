import { ApiError, httpClient } from "@/services/http-client";

export type Points = number | string;
export type ExamKind = "multiple_choice" | "written" | "mixed";
export type FileRole = "exam" | "answer" | "official";

export interface Question {
  id: string;
  prompt: string;
  max_points: Points;
  options: Record<string, string>;
}

export interface Criterion {
  label: string;
  max_points: Points;
}

export interface TeacherQuestion extends Question {
  solution: string;
  correct_options: string[];
  rubric: Criterion[];
}

export interface AssignmentSummary {
  id: string;
  title: string;
  question_count: number;
  max_total: Points;
  created_at: string;
  submission_id: string | null;
  submission_count: number | null;
}

export interface Assignment extends AssignmentSummary {
  questions: (Question | TeacherQuestion)[];
}

export interface RecognizedAnswer {
  id: string;
  status: "answered" | "blank" | "unreadable";
  text: string;
  selected_options: string[];
  evidence: string;
}

export interface ExamFile {
  id: string;
  role: FileRole;
  name: string;
  media_type: string;
}

export interface QuestionGrade {
  id: string;
  points: Points;
  max_points: Points;
  correct_options: string[];
  feedback: string;
  correction: string;
  source: "teacher" | "official" | "ai";
  criteria: (Criterion & { points: Points; quote: string; feedback: string })[];
}

export interface SubmissionSummary {
  id: string;
  title: string;
  state: "graded" | "needs_review" | "finalized";
  kind: ExamKind | null;
  ai_total: Points | null;
  max_total: Points | null;
  official_total: Points | null;
  created_at: string;
  student_name: string | null;
}

export interface OfficialScore {
  id: string;
  points: Points;
}

export interface Submission extends SubmissionSummary {
  revision: number;
  analysis: {
    reason: string;
    questions: Question[];
    answers: RecognizedAnswer[];
    grades: QuestionGrade[];
    review_items?: { id: string; reason: string }[];
    pages: {
      role: FileRole; file: string; page: number; text: string; readable: boolean;
      choices: { label: string; selected_options: string[] }[];
    }[];
  };
  official: { total: Points; scores: OfficialScore[]; comment: string; finalized_at: string } | null;
  files: ExamFile[];
}

export interface AssignmentInput {
  title: string;
  questions: TeacherQuestion[];
}

function appendFiles(form: FormData, field: FileRole, files: File[]) {
  for (const file of files) form.append(`${field}_files`, file);
}

const assignmentPath = (classId: string) => `/classes/${classId}/assignments`;
const submissionPath = (submissionId: string) => `/exams/submissions/${submissionId}`;

async function requireExamApi<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.message === "Not Found") {
      throw new ApiError("Phiên bản máy chủ đang kết nối chưa có tính năng chấm bài.", error.status);
    }
    throw error;
  }
}

export const examApi = {
  history: () => requireExamApi(httpClient.get<SubmissionSummary[]>("/exams/history")),
  personal(exam: File[], answer: File[], official: File[]) {
    const form = new FormData();
    appendFiles(form, "exam", exam);
    appendFiles(form, "answer", answer);
    appendFiles(form, "official", official);
    return requireExamApi(httpClient.post<Submission>("/exams/submissions", form));
  },
  submission: (id: string) => httpClient.get<Submission>(submissionPath(id)),
  regradePersonal: (submission: Submission) => requireExamApi(
    httpClient.post<Submission>(`${submissionPath(submission.id)}/regrade`, { revision: submission.revision }),
  ),
  file: (submissionId: string, fileId: string) => httpClient.getBlob(`${submissionPath(submissionId)}/files/${fileId}`),
  assignments: (classId: string) => requireExamApi(httpClient.get<AssignmentSummary[]>(assignmentPath(classId))),
  create: (classId: string, data: AssignmentInput) => httpClient.post<Assignment>(assignmentPath(classId), data),
  assignment: (classId: string, id: string) => httpClient.get<Assignment>(`${assignmentPath(classId)}/${id}`),
  classSubmissions: (classId: string, id: string) =>
    httpClient.get<SubmissionSummary[]>(`${assignmentPath(classId)}/${id}/submissions`),
  submitClasswork(classId: string, id: string, files: File[]) {
    const form = new FormData();
    appendFiles(form, "answer", files);
    return httpClient.post<Submission>(`${assignmentPath(classId)}/${id}/submissions`, form);
  },
  regrade: (classId: string, id: string, submission: Submission) =>
    httpClient.post<Submission>(`${assignmentPath(classId)}/${id}/submissions/${submission.id}/regrade`, {
      revision: submission.revision,
    }),
  finalize: (classId: string, id: string, submission: Submission, scores: OfficialScore[], comment: string) =>
    httpClient.post<Submission>(`${assignmentPath(classId)}/${id}/submissions/${submission.id}/finalize`, {
      revision: submission.revision,
      scores,
      comment,
    }),
};
