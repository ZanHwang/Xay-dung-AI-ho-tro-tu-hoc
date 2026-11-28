"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FileSearch, History, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExamFilePicker } from "./exam-files";
import { ExamResult, ExamStatus, formatPoints } from "./exam-result";
import { examApi, type Submission, type SubmissionSummary } from "../services/exam-api";

export function PersonalExams() {
  const [exam, setExam] = useState<File[]>([]);
  const [answer, setAnswer] = useState<File[]>([]);
  const [official, setOfficial] = useState<File[]>([]);
  const [result, setResult] = useState<Submission | null>(null);
  const [history, setHistory] = useState<SubmissionSummary[] | null>(null);
  const [busy, setBusy] = useState<"grade" | "history" | "retry" | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [retryError, setRetryError] = useState("");

  useEffect(() => {
    let current = true;
    examApi.history().then((items) => {
      if (current) setHistory((previous) => previous
        ? [...previous, ...items.filter((item) => !previous.some((saved) => saved.id === item.id))]
        : items);
    }).catch((err: unknown) => {
      if (current) setHistoryError(err instanceof Error ? err.message : "Không tải được lịch sử.");
    });
    return () => { current = false; };
  }, []);

  async function grade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("grade");
    setError("");
    setRetryError("");
    try {
      const submission = await examApi.personal(exam, answer, official);
      setResult(submission);
      setHistory((previous) => [submission, ...(previous ?? [])]);
      setHistoryError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa chấm được bài thi.");
    } finally {
      setBusy(null);
    }
  }

  async function openSubmission(id: string) {
    setBusy("history");
    setError("");
    setRetryError("");
    try {
      setResult(await examApi.submission(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được kết quả.");
    } finally {
      setBusy(null);
    }
  }

  async function regrade(submission: Submission) {
    setBusy("retry");
    setRetryError("");
    try {
      const updated = await examApi.regradePersonal(submission);
      setResult(updated);
      setHistory((previous) => previous?.map((item) => item.id === updated.id ? updated : item) ?? null);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Chưa chấm lại được bài.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="two-col">
      <div className="panel-stack">
        <section className="panel">
          <h2>Bài cần chấm</h2>
          <form onSubmit={grade} className="space-y-3">
            <ExamFilePicker label="Đề thi" tone="cover-cyan" files={exam} onChange={setExam} disabled={!!busy} />
            <ExamFilePicker label="Bài làm" tone="cover-violet" files={answer} onChange={setAnswer} disabled={!!busy} />
            <ExamFilePicker label="Đáp án hoặc barem chính thức" tone="cover-amber" files={official} onChange={setOfficial} optional disabled={!!busy} />
            <Button type="submit" disabled={!!busy || !exam.length || !answer.length} className="w-full">
              <Sparkles aria-hidden /> {busy === "grade" ? "Đang nhận diện và chấm…" : "Nhận diện và chấm bài"}
            </Button>
          </form>
          <p className="meta mt-2">PDF, PNG hoặc JPEG. Tối đa 8 MB mỗi tệp và 12 trang, ảnh mỗi lượt.</p>
          {error ? <p role="alert" className="error-box mt-3">{error}</p> : null}
        </section>
        <section className="panel">
          <h2 className="flex items-center gap-2"><History className="size-5" aria-hidden /> Đã chấm</h2>
          {historyError ? <p className="meta" role="status">{historyError}</p> : null}
          {history === null && !historyError ? <p className="meta" role="status">Đang tải lịch sử…</p> : null}
          {history?.length === 0 ? <p className="meta">Chưa có bài thi đã nộp.</p> : null}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {history?.map((item) => (
              <li key={item.id}>
                <button
                  type="button" disabled={!!busy} aria-pressed={result?.id === item.id}
                  onClick={() => void openSubmission(item.id)}
                  className="row-link aria-pressed:bg-[var(--accent-soft)]"
                >
                  <span className="grow">
                    <span className="title">{new Date(item.created_at + (item.created_at.endsWith("Z") ? "" : "Z")).toLocaleString("vi-VN")}</span>
                    {item.ai_total !== null && item.max_total !== null ? (
                      <span className="sub2">{formatPoints(item.ai_total)} / {formatPoints(item.max_total)} điểm</span>
                    ) : null}
                  </span>
                  <ExamStatus state={item.state} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel" aria-label="Kết quả chấm">
        {result ? (
          <div className="space-y-4">
            {result.state === "needs_review" ? (
              <div>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => void regrade(result)}>
                  <RefreshCw aria-hidden className={busy === "retry" ? "animate-spin" : undefined} />
                  {busy === "retry" ? "Đang chấm lại…" : "Chấm lại bài đã tải"}
                </Button>
                {retryError ? <p role="alert" className="error-box mt-2">{retryError}</p> : null}
              </div>
            ) : null}
            <ExamResult result={result} />
          </div>
        ) : (
          <div className="empty">
            <FileSearch className="mb-2 size-8" aria-hidden />
            <h3>{busy === "grade" ? "Đang xử lý bài thi" : "Chưa có kết quả"}</h3>
            <p>{busy === "grade" ? "AI đang đọc các trang và đối chiếu từng câu." : "Tải đề và bài làm lên hoặc mở một lượt chấm từ lịch sử."}</p>
          </div>
        )}
      </section>
    </div>
  );
}
