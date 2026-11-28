import {
  Home, MessageCircle, PenLine, Users,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@/features/workspace/types";

export type NavigationItem = { id: NavKey; label: string; icon: LucideIcon };

// Main menu: hôm nay · hỏi AI · chấm bài · lớp học. The subjects pages live
// under "Hôm nay"; the profile opens from the name button at the bottom of the
// sidebar. Quiz lives inside a subject's own "Quiz" tab (SubjectQuizSummary) and
// is opened as a full-screen popup (QuizOverlay, see use-quiz-overlay.ts) from
// anywhere else - never a top-level page.
export const navigationItems: NavigationItem[] = [
  { id: "dashboard", label: "Hôm nay", icon: Home },
  { id: "tutor", label: "Hỏi AI", icon: MessageCircle },
  { id: "essay", label: "Chấm bài", icon: PenLine },
  { id: "classes", label: "Lớp học", icon: Users },
];
