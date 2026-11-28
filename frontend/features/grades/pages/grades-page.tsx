"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ResultRow } from "@/features/dashboard/services/dashboard-store";
import { useOpenResult } from "@/features/quiz/hooks/use-open-result";
import type { QuizController } from "@/features/quiz/hooks/use-quizzes";
import type { Quiz } from "@/features/quiz/types";
import { byRecentUse, type Subject } from "@/features/subjects/types";
import { ScoreRow } from "../components/score-row";
import { gradesApi } from "../services/grades-api";

const PAGE = 20;

type Props = {
  subjects: Subject[];
  quizzes: QuizController;
  onViewQuiz: (quiz: Quiz, opts?: { attemptId?: string }) => void;
  onBack: () => void;
};

/** Sổ điểm: every quiz submission, newest first, a page at a time. */
export function GradesPage({ subjects, quizzes, onViewQuiz, onBack }: Props) {
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const opener = useOpenResult(quizzes, onViewQuiz);
  // Only the latest request may fill the list (the filter can change while a page loads).
  const latest = useRef(0);

  const load = useCallback(async (offset: number) => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const page = await gradesApi.results({ subjectId: subjectId || undefined, limit: PAGE, offset });
      if (request !== latest.current) return;
      setTotal(page.total);
      setRows((current) => {
        const kept = offset === 0 ? [] : current;
        const known = new Set(kept.map((row) => row.id));
        return [...kept, ...page.results.filter((row) => !known.has(row.id))];
      });
    } catch {
      if (request === latest.current) setError("Không tải được sổ điểm.");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    // Filter changed: start again from the newest. The list is replaced when
    // the first page arrives, so nothing from the old filter lingers.
    void load(0);
  }, [load]);

  const subjectOf = (row: ResultRow) =>
    subjects.find((subject) => subject.id === (row.subject_id ?? quizzes.quizzes.find((quiz) => quiz.backendId === row.quiz_id)?.subjectId));
  const left = total - rows.length;

  return (
    <div className="page grades-page">
      <button type="button" onClick={onBack} className="link-btn mb-3 gap-2">
        <ArrowLeft className="size-4" aria-hidden="true" /> Hôm nay
      </button>
      <div className="view-head">
        <h1>Sổ điểm</h1>
        <p>Mọi lần làm quiz, mới nhất ở trên. Lượt ôn vài câu ghi số câu đúng thay cho điểm.</p>
      </div>

      <div className="grades-tools">
        <label className="lbl">
          Môn
          <select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">Tất cả môn</option>
            {byRecentUse(subjects).map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </label>
        {!loading || rows.length ? <p className="meta" role="status">{total} lần làm</p> : null}
      </div>

      {error || opener.error ? (
        <div role="alert" className="error-box mb-4 flex items-center justify-between gap-4">
          <p className="flex-1">{error || opener.error}</p>
          {error ? <button type="button" className="btn btn-sm btn-danger" onClick={() => void load(rows.length)}>Thử lại</button> : null}
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="space-y-2" role="status" aria-label="Đang tải điểm">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-14 animate-pulse" style={{ borderRadius: 8, background: "var(--surface-2)" }} />
          ))}
        </div>
      ) : rows.length === 0 && !error ? (
        <p className="empty">{subjectId ? "Môn này chưa có bài quiz nào." : "Chưa có điểm nào. Mở một môn, tạo quiz và làm thử."}</p>
      ) : (
        <div className="grades-list">
          {rows.map((row) => (
            <ScoreRow
              key={row.id}
              row={row}
              subject={subjectOf(row)}
              busy={opener.opening === row.id}
              onOpen={(item) => void opener.open(item.quiz_id, item.id)}
            />
          ))}
        </div>
      )}

      {left > 0 && rows.length > 0 ? (
        <button type="button" className="btn btn-outline mt-4" disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? "Đang tải…" : `Tải thêm (còn ${left})`}
        </button>
      ) : null}
    </div>
  );
}
