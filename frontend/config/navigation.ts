import {
  BookOpen, Bot, LayoutDashboard, PenLine, Users, User,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@/features/workspace/types";

export type NavigationItem = { id: NavKey; label: string; icon: LucideIcon };

// Main menu (v2 layout): dashboard · môn · tutor · essay · lớp · hồ sơ.
// Quiz lives inside a subject's own "Quiz" tab (SubjectQuizSummary) and is
// opened as a full-screen popup (QuizOverlay, see use-quiz-overlay.ts) from
// anywhere else (Dashboard, header bell) - never a top-level page.
export const navigationItems: NavigationItem[] = [
  { id: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { id: "subjects", label: "Môn học", icon: BookOpen },
  { id: "tutor", label: "AI Tutor", icon: Bot },
  { id: "essay", label: "Chấm bài", icon: PenLine },
  { id: "classes", label: "Lớp học", icon: Users },
  { id: "settings", label: "Hồ sơ", icon: User },
];

export const pageTitles: Record<NavKey, string> = {
  dashboard: "Tổng quan",
  subjects: "Môn học",
  tutor: "AI Tutor",
  essay: "Chấm bài",
  classes: "Lớp học",
  settings: "Hồ sơ",
};
