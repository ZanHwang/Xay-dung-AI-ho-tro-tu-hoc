import type { Subject } from "@/features/subjects/types";

const now = "2026-01-01T00:00:00.000Z";

export const initialSubjects: Subject[] = [
  {
    id: "information-theory",
    name: "Lý thuyết thông tin",
    shortName: "LTTT",
    description:
      "Entropy, mã hóa nguồn, thông tin tương hỗ và dung lượng kênh.",
    color: "#22d3ee",
    created_at: now,
    updated_at: now,
    progress: 68,
    lessons: 12,
    lastStudied: "Hôm nay, 20:30",
    accent: "cyan",
    currentTopic: "Mutual Information",
  },
  {
    id: "machine-learning",
    name: "Học máy",
    shortName: "ML",
    description:
      "Các mô hình học có giám sát, đánh giá và tối ưu mô hình.",
    color: "#a855f7",
    created_at: now,
    updated_at: now,
    progress: 54,
    lessons: 18,
    lastStudied: "Hôm qua",
    accent: "violet",
    currentTopic: "Regularization",
  },
  {
    id: "natural-language-processing",
    name: "Xử lý ngôn ngữ tự nhiên",
    shortName: "NLP",
    description:
      "Tiền xử lý tiếng Việt, embedding, Transformer và PhoBERT.",
    color: "#f59e0b",
    created_at: now,
    updated_at: now,
    progress: 41,
    lessons: 14,
    lastStudied: "3 ngày trước",
    accent: "amber",
    currentTopic: "Attention mechanism",
  },
];
