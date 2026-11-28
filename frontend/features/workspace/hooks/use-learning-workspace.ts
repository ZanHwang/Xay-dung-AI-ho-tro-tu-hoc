"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subjectApi, getDemoSubjects } from "@/features/subjects/services/subject-api";
import {
  colorToAccent,
  type CreateSubjectInput,
  type Subject,
} from "@/features/subjects/types";
import type { NavKey } from "@/features/workspace/types";
import { uploadDocument } from "@/features/subjects/services/document-api";

const validPages: NavKey[] = ["dashboard", "tutor", "subjects", "grades", "settings", "essay", "classes"];

// The open tab lives in the URL hash (/workspace#tutor). The hash is purely
// client-side - the server only ever renders /workspace - so it dodges the
// framework's SSR of sub-routes, while each tab switch still owns a history
// entry: the browser back/forward buttons walk the tabs *inside* the app
// instead of exiting to /login.
function tabFromHash(hash: string): NavKey {
  const tab = hash.replace(/^#/, "");
  return tab && validPages.includes(tab as NavKey) ? (tab as NavKey) : "dashboard";
}

function hashForTab(page: NavKey): string {
  return `#${page}`;
}

function useHashTab(): NavKey {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  // Server renders the dashboard tab; after mount the real hash wins.
  return useSyncExternalStore(
    subscribe,
    () => tabFromHash(window.location.hash),
    () => "dashboard",
  );
}

// Load demo subjects locally or the API list, whatever applies. Module-scope
// so the mount effect and the retry button share one path.
async function loadSubjectsList(isDemo: boolean): Promise<Subject[]> {
  if (isDemo) return getDemoSubjects();
  return subjectApi.list();
}

// Check if we should use API or demo mode
function isDemoMode(): boolean {
  if (typeof window === "undefined") return true;
  return !process.env.NEXT_PUBLIC_API_BASE_URL && !sessionStorage.getItem("jarvis.auth.token");
}

export function useLearningWorkspace(onTutorEnter: () => void) {
  // The tab is read from the URL hash via useSyncExternalStore; the server
  // always "renders" the dashboard tab, the client hash takes over on mount.
  const activePage = useHashTab();
  const [hasOpenedTutor, setHasOpenedTutor] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subjectsRef = useRef<Subject[]>([]);
  const isDemo = isDemoMode();

  const inFlightRef = useRef(false);
  // Retryable loader for the "Thử lại" button. setLoading(true) up front
  // doubles as the double-click guard alongside inFlightRef.
  const refreshSubjects = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setLoading(true);
      setError(null);
      const list = await loadSubjectsList(isDemo);
      setSubjects(list);
    } catch (err) {
      console.error("Failed to load subjects:", err);
      setError("Không thể tải danh sách môn học.");
      // Fallback to demo subjects
      if (isDemo) setSubjects(getDemoSubjects());
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [isDemo]);

  // Load subjects on mount; the retry path (refreshSubjects) is returned so
  // the UI can offer "Thử lại" when this first fetch fails (e.g. the backend
  // was still starting, or the token 401'd mid-load).
  useEffect(() => {
    let disposed = false;
    loadSubjectsList(isDemo)
      .then((list) => {
        if (disposed) return;
        setSubjects(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.error("Failed to load subjects:", err);
        setError("Không thể tải danh sách môn học.");
        if (isDemo) setSubjects(getDemoSubjects());
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [isDemo]);

  // Update ref when subjects change
  useEffect(() => {
    subjectsRef.current = subjects;
  }, [subjects]);

  // Coming back to Hôm nay or Môn học: fetch the list again, quietly, so the
  // "used most recently" order (stats.last_activity) catches up with what was
  // just studied. A failure keeps the list already shown.
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    if (isDemo || (activePage !== "dashboard" && activePage !== "subjects")) return;
    let disposed = false;
    subjectApi.list()
      .then((list) => { if (!disposed) setSubjects(list); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [activePage, isDemo]);

  // Selection only matters on the subjects tab: navigating away (via the
  // back button or a sidebar tab) is a URL change, so we derive the visible
  // subject from the active tab instead of a state-clearing effect.
  const selectedSubject = useMemo(
    () =>
      activePage === "subjects"
        ? subjects.find((subject) => subject.id === selectedSubjectId)
        : undefined,
    [selectedSubjectId, subjects, activePage],
  );

  const navigate = useCallback((page: NavKey, preserveConversation = false) => {
    if (page === "tutor" && !preserveConversation) onTutorEnter();
    if (page === "tutor") setHasOpenedTutor(true);
    // Skip the switch when we're already on this tab - a redundant history
    // entry would make "back" feel like it does nothing.
    if (page === activePage) return;
    window.location.hash = hashForTab(page);
  }, [onTutorEnter, activePage]);

  const openSubject = useCallback((id: string) => {
    setSelectedSubjectId(id);
    if (activePage !== "subjects") window.location.hash = hashForTab("subjects");
  }, [activePage]);

  const addSubject = useCallback(async (input: CreateSubjectInput, files: File[] = []) => {
    if (isDemo) {
      // Create demo subject locally
      const newSubject: Subject = {
        id: `demo-${Date.now()}`,
        name: input.name,
        description: input.description ?? "",
        color: input.color ?? "#6366f1",
        icon: input.icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        shortName: input.name.slice(0, 4).toUpperCase(),
        progress: 0,
        lessons: 0,
        lastStudied: "Chưa học",
        accent: input.color ? colorToAccent(input.color) : "emerald",
      };

      const next = [newSubject, ...subjectsRef.current];
      subjectsRef.current = next;
      setSubjects(next);
      return newSubject;
    }

    // Create via API
    try {
      const subject = await subjectApi.create(input);
      // First: a new subject leads the list until the next reload.
      const next = [subject, ...subjectsRef.current];
      subjectsRef.current = next;
      setSubjects(next);

      // Upload any attached files to the new subject. The first failure aborts
      // the batch and surfaces the error to the caller so the user can retry.
      if (files.length > 0) {
        for (const file of files) {
          try {
            await uploadDocument(subject.id, file);
          } catch (uploadError) {
            console.error("Failed to upload document:", uploadError);
            throw new Error(
              uploadError instanceof Error
                ? `Môn học đã tạo nhưng upload "${file.name}" thất bại: ${uploadError.message}`
                : `Môn học đã tạo nhưng upload "${file.name}" thất bại.`,
            );
          }
        }
      }

      return subject;
    } catch (err) {
      console.error("Failed to create subject:", err);
      throw err instanceof Error
        ? err
        : new Error("Không thể tạo môn học. Vui lòng thử lại.");
    }
  }, [isDemo]);

  const updateSubject = useCallback(async (id: string, input: Partial<CreateSubjectInput>) => {
    if (isDemo) {
      // Update demo subject locally
      const next = subjectsRef.current.map((s) =>
        s.id === id ? { ...s, ...input, accent: input.color ? colorToAccent(input.color) : s.accent } : s
      );
      subjectsRef.current = next;
      setSubjects(next);
      return;
    }

    // Update via API
    const updated = await subjectApi.update(id, input);
    const next = subjectsRef.current.map((s) => (s.id === id ? updated : s));
    subjectsRef.current = next;
    setSubjects(next);
  }, [isDemo]);

  const deleteSubject = useCallback(async (id: string) => {
    if (isDemo) {
      // Delete demo subject locally
      const next = subjectsRef.current.filter((s) => s.id !== id);
      subjectsRef.current = next;
      setSubjects(next);
      return;
    }

    // Delete via API
    await subjectApi.delete(id);
    const next = subjectsRef.current.filter((s) => s.id !== id);
    subjectsRef.current = next;
    setSubjects(next);
  }, [isDemo]);

  // Register tools for AI integration
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();

    const registerTools = async () => {
      await context.registerTool(
        {
          name: "navigate_learning_workspace",
          title: "Đi đến khu vực học tập",
          description:
            "Mở Dashboard, AI Tutor, Môn học, Tự luận, Lớp học hoặc Cài đặt trong giao diện JARVIS.",
          inputSchema: {
            type: "object",
            properties: { page: { type: "string", enum: validPages } },
            required: ["page"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute(input: unknown) {
            const page = (input as { page?: string })?.page;
            if (!validPages.includes(page as NavKey)) {
              throw new Error("Khu vực không hợp lệ.");
            }
            navigate(page as NavKey);
            return { page, status: "opened" };
          },
        },
        { signal: lifecycle.signal },
      );

      await context.registerTool(
        {
          name: "create_subject",
          title: "Tạo môn học",
          description: "Tạo một môn học mới trong JARVIS.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1 },
              description: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input: unknown) {
            const value = input as { name?: string; description?: string };
            if (!value.name?.trim()) {
              throw new Error("Tên môn học không được để trống.");
            }
            const subject = await addSubject({
              name: value.name,
              description: value.description ?? "",
            });
            openSubject(subject.id);
            return { id: subject.id, name: subject.name, status: "created" };
          },
        },
        { signal: lifecycle.signal },
      );
    };

    void registerTools().catch(() => undefined);
    return () => lifecycle.abort();
  }, [addSubject, navigate, openSubject]);

  return {
    activePage,
    hasOpenedTutor,
    subjects,
    selectedSubject,
    loading,
    error,
    retryLoadSubjects: () => {
      setLoading(true);
      void refreshSubjects();
    },
    navigate,
    openSubject,
    clearSelectedSubject: () => setSelectedSubjectId(null),
    addSubject,
    updateSubject,
    deleteSubject,
  };
}
