// =============================================================================
// Subject Accent (UI color theme)
// =============================================================================

export type SubjectAccent = "cyan" | "violet" | "amber" | "emerald";

// =============================================================================
// Frontend Subject (aligned with backend + UI computed fields)
// =============================================================================

export type Subject = {
  // Core fields (from backend)
  id: string;
  name: string;
  description: string;

  // Backend fields
  color: string;           // #RRGGBB format
  icon?: string;
  learning_goal?: string;
  start_date?: string;
  deadline?: string;
  created_at: string;
  updated_at: string;

  // UI computed fields
  shortName: string;       // Computed from name (e.g., "Toán" → "TOAN")
  progress: number;        // Always 0 from the real API ("Chủ đề" removed, no mastery source left)
  lessons: number;         // Always 0 from the real API ("Chủ đề" removed, no topic count left)
  lastStudied: string;     // From stats.last_activity
  accent: SubjectAccent;   // Derived from color
  currentTopic?: string;   // User's current topic
};

// =============================================================================
// Subject Stats (from backend)
// =============================================================================

export interface SubjectStats {
  total_documents: number;
  total_quizzes: number;
  last_activity: string | null;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiSubject {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  learning_goal: string | null;
  start_date: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  stats?: SubjectStats;
}

export interface SubjectListResponse {
  total: number;
  subjects: ApiSubject[];
}

// =============================================================================
// Input Types
// =============================================================================

export interface CreateSubjectInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  learning_goal?: string;
  start_date?: string;
  deadline?: string;
}

export interface UpdateSubjectInput {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  learning_goal?: string;
  start_date?: string;
  deadline?: string;
}

// =============================================================================
// Color ↔ Accent Mapping Utilities
// =============================================================================

const ACCENT_TO_COLOR: Record<SubjectAccent, string> = {
  cyan: "#06b6d4",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  emerald: "#10b981",
};

const COLOR_TO_ACCENT: Record<string, SubjectAccent> = {
  "#06b6d4": "cyan",
  "#8b5cf6": "violet",
  "#f59e0b": "amber",
  "#10b981": "emerald",
};

/**
 * Convert accent to hex color
 */
export function accentToColor(accent: SubjectAccent): string {
  return ACCENT_TO_COLOR[accent];
}

/**
 * Convert hex color to accent
 */
export function colorToAccent(color: string): SubjectAccent {
  // Try exact match first
  const lowerColor = color.toLowerCase();
  if (COLOR_TO_ACCENT[lowerColor]) {
    return COLOR_TO_ACCENT[lowerColor];
  }

  // Parse RGB for approximate matching
  const hex = lowerColor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Determine approximate color family
  if (r > g && r > b) {
    // Red/yellow dominant → amber
    if (g > 150) return "amber";
    return "violet"; // Red dominant could be violet-ish
  }
  if (b > r && b > g) {
    return "cyan"; // Blue dominant
  }
  if (g > r && g > b) {
    return "emerald"; // Green dominant
  }

  // Default fallback
  return "emerald";
}

/**
 * Generate short name from full name
 */
export function createShortName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}
