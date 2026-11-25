import { httpClient } from "@/services/http-client";

// =============================================================================
// Classes (lớp học) API client.
// =============================================================================

export interface ClassRoom {
  id: string;
  name: string;
  code: string;
  teacher_id: string | null;
  students: number;
}

export interface ClassMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface PendingEssay {
  id: string;
  student: string;
  prompt: string;
  essay: string;
  status: string;
  created_at: string;
}

export interface BatchGradeResult {
  graded: number;
  total: number;
  average: number;
}

export const classesApi = {
  /** Classes the user teaches OR is enrolled in. */
  async list(): Promise<ClassRoom[]> {
    return httpClient.get<ClassRoom[]>("/classes/");
  },

  /** Teacher: create a class + auto-enroll the teacher. */
  async create(name: string): Promise<ClassRoom> {
    return httpClient.post<ClassRoom>("/classes/", { name });
  },

  /** Join a class by its 6-char code. */
  async join(code: string): Promise<ClassRoom> {
    return httpClient.post<ClassRoom>("/classes/join", { code });
  },

  async members(classId: string): Promise<ClassMember[]> {
    return httpClient.get<ClassMember[]>(`/classes/${classId}/members`);
  },

  /** Teacher: pending (ungraded) essays in a class. */
  async pendingEssays(classId: string): Promise<{ total: number; essays: PendingEssay[] }> {
    return httpClient.get<{ total: number; essays: PendingEssay[] }>(
      `/classes/${classId}/essays/pending`,
    );
  },

  /** Teacher: batch-grade every pending essay with one prompt + barem. */
  async gradeBatch(classId: string, prompt: string, rubric: unknown): Promise<BatchGradeResult> {
    return httpClient.post<BatchGradeResult>(`/classes/${classId}/essays/grade-batch`, {
      prompt,
      rubric,
    });
  },
};
