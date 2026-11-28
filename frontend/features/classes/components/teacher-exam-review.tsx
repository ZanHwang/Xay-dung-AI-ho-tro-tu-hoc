"use client";

import { useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExamResult, formatPoints } from "@/features/essay/components/exam-result";
import { examApi, type Assignment, type Submission } from "@/features/essay/services/exam-api";

export function TeacherExamReview({
  classId, assignment, submission, onChange, onRefresh,
}: {
  classId: string; assignment: Assignment; submission: Submission;
  onChange: (value: Submission) => void; onRefresh: () => void;
}) {
  const [points, setPoints] = useState<Record<string, string>>(
    () => Object.fromEntries(submission.analysis.grades.map((grade) => [grade.id, String(grade.points)])),
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"regrade" | "finalize" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  async function update(action: "regrade" | "finalize") {
    setBusy(action);
    setError("");
    try {
      const next = action === "regrade"
        ? await examApi.regrade(classId, assignment.id, submission)
        : await examApi.finalize(classId, assignment.id, submission,
          assignment.questions.map((question) => ({ id: question.id, points: points[question.id] })), comment);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa cập nhật được bài nộp.");
    } finally {
      setBusy(null);
    }
  }

  function beforeFinalize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirm(true);
  }

  return (
    <div className="space-y-5">
      <ExamResult result={submission} />
      {submission.official ? null : (
        <form onSubmit={beforeFinalize} className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">Điểm chính thức</h4>
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => void update("regrade")}>
              <RefreshCw className={busy === "regrade" ? "animate-spin" : undefined} />
              {busy === "regrade" ? "Đang chấm lại…" : "Yêu cầu AI chấm lại"}
            </Button>
          </div>
          <fieldset disabled={!!busy} className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {assignment.questions.map((question) => (
                <label key={question.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-2.5 text-sm">
                  <span>Câu {question.id} · tối đa {formatPoints(question.max_points)}</span>
                  <input
                    type="number" className="input !w-24" required min="0" max={question.max_points} step="0.01"
                    value={points[question.id] ?? ""} onChange={(event) => setPoints((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium">
              Nhận xét cho học sinh
              <textarea className="input mt-1" rows={3} value={comment} maxLength={8000}
                onChange={(event) => setComment(event.target.value)} />
            </label>
            <Button type="submit">{busy === "finalize" ? "Đang chốt…" : "Chốt điểm chính thức"}</Button>
          </fieldset>
          {error ? (
            <div className="space-y-2">
              <p role="alert" className="error-box">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={onRefresh}>Tải lại bài nộp</Button>
            </div>
          ) : null}
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Chốt điểm cho học sinh?</AlertDialogTitle>
                <AlertDialogDescription>Học sinh sẽ thấy điểm và nhận xét. Bài chấm sẽ được khóa sau khi chốt.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Kiểm tra lại</AlertDialogCancel>
                <AlertDialogAction onClick={() => void update("finalize")}>Xác nhận chốt điểm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </form>
      )}
    </div>
  );
}
