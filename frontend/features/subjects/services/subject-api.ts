import { httpClient } from "@/services/http-client";
import {
  type Subject,
  type SubjectStats,
  type CreateSubjectInput,
  type UpdateSubjectInput,
  type ApiSubject,
  type SubjectListResponse,
  subjectAccent,
  createShortName,
} from "../types";

// =============================================================================
// Map Backend to Frontend
// =============================================================================

function mapApiSubject(api: ApiSubject): Subject {
  const accent = subjectAccent(api.color, api.id);

  return {
    // Core fields
    id: api.id,
    name: api.name,
    description: api.description ?? "",

    // Backend fields
    color: api.color,
    icon: api.icon,
    learning_goal: api.learning_goal ?? undefined,
    start_date: api.start_date ?? undefined,
    deadline: api.deadline ?? undefined,
    created_at: api.created_at,
    updated_at: api.updated_at,

    // UI computed fields
    shortName: createShortName(api.name),
    // "Chủ đề" (Topic/Progress) was removed — there's no real source for
    // these anymore; kept at 0 since other Subject consumers (mocks,
    // localStorage demo subjects) still expect the fields to exist.
    progress: 0,
    lessons: 0,
    lastStudied: api.stats?.last_activity
      ? new Date(api.stats.last_activity).toLocaleDateString("vi-VN")
      : "Chưa học",
    accent,
    currentTopic: undefined, // TODO: Get from user's current topic setting
    documentCount: api.stats?.total_documents,
    quizCount: api.stats?.total_quizzes,
  };
}

// =============================================================================
// Subject API Service
// =============================================================================

export const subjectApi = {
  /**
   * Fetch all subjects for current user
   */
  async list(): Promise<Subject[]> {
    const response: SubjectListResponse = await httpClient.get("/subjects/");
    return response.subjects.map(mapApiSubject);
  },

  /**
   * Get single subject with stats
   */
  async get(id: string): Promise<Subject> {
    const api: ApiSubject = await httpClient.get(`/subjects/${id}`);
    return mapApiSubject(api);
  },

  /**
   * Create new subject
   */
  async create(input: CreateSubjectInput): Promise<Subject> {
    const payload = {
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "#6366f1",
      icon: input.icon ?? "book",
      learning_goal: input.learning_goal ?? null,
      start_date: input.start_date ?? null,
      deadline: input.deadline ?? null,
    };

    const api: ApiSubject = await httpClient.post("/subjects/", payload);
    return mapApiSubject(api);
  },

  /**
   * Update subject
   */
  async update(id: string, input: UpdateSubjectInput): Promise<Subject> {
    const payload: Record<string, unknown> = {};

    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.color !== undefined) payload.color = input.color;
    if (input.icon !== undefined) payload.icon = input.icon;
    if (input.learning_goal !== undefined) payload.learning_goal = input.learning_goal;
    if (input.start_date !== undefined) payload.start_date = input.start_date;
    if (input.deadline !== undefined) payload.deadline = input.deadline;

    const api: ApiSubject = await httpClient.put(`/subjects/${id}`, payload);
    return mapApiSubject(api);
  },

  /**
   * Delete subject
   */
  async delete(id: string): Promise<void> {
    await httpClient.delete(`/subjects/${id}`);
  },

  /**
   * Get subject statistics
   */
  async getStats(id: string): Promise<SubjectStats> {
    return httpClient.get(`/subjects/${id}/stats`);
  },

  /**
   * Subject names that already exist (across every user) - lets someone
   * naming a new subject reuse an existing name instead of a slightly
   * different spelling, so they land on the SAME shared question bank (two
   * subjects named differently enough end up as two separate pools - see
   * backend subject_key_for). `query` filters (contains, case-insensitive).
   */
  async getKnownNames(query?: string): Promise<string[]> {
    const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    const response: { names: string[] } = await httpClient.get(`/subjects/known-names/${qs}`);
    return response.names ?? [];
  },
};

// =============================================================================
// Demo/Mock Data (for development without backend)
// =============================================================================

import type { SubjectAccent } from "../types";

const DEMO_SUBJECTS: Subject[] = [
  {
    id: "demo-1",
    name: "Toán Cao Cấp",
    description: "Giải tích, Đại số tuyến tính, Xác suất thống kê",
    color: "#8b5cf6",
    icon: "calculator",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shortName: "TOCA",
    progress: 65,
    lessons: 12,
    lastStudied: "Hôm qua",
    accent: "violet" as SubjectAccent,
  },
  {
    id: "demo-2",
    name: "Vật Lý Đại Cương",
    description: "Cơ học, Nhiệt học, Điện từ học, Quang học",
    color: "#06b6d4",
    icon: "atom",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shortName: "VALI",
    progress: 45,
    lessons: 8,
    lastStudied: "3 ngày trước",
    accent: "cyan" as SubjectAccent,
  },
  {
    id: "demo-3",
    name: "Lập Trình Python",
    description: "Python cơ bản, OOP, Data Structures, Algorithms",
    color: "#10b981",
    icon: "code",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shortName: "LTPY",
    progress: 80,
    lessons: 15,
    lastStudied: "Hôm nay",
    accent: "emerald" as SubjectAccent,
  },
];

/**
 * Get demo subjects (for development/fallback)
 */
export function getDemoSubjects(): Subject[] {
  return DEMO_SUBJECTS;
}
