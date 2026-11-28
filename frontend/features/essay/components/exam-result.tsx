"use client";

import { CheckCircle2, ScanText } from "lucide-react";
import { MarkdownContent } from "@/features/tutor/components/markdown-content";
import type { ExamKind, Points, Question, Submission, SubmissionSummary } from "../services/exam-api";
import { ExamOriginals, fileRoles } from "./exam-files";

const kinds: Record<ExamKind, string> = {
  multiple_choice: "Trắc nghiệm",
  written: "Tự luận",
  mixed: "Đề kết hợp",
};
const sources = { teacher: "Barem giáo viên", official: "Đáp án chính thức", ai: "Đáp án do AI lập" };

export function formatPoints(points: Points): string {
  return Number(points).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export function ExamStatus({ state }: { state: SubmissionSummary["state"] }) {
  if (state === "needs_review") return <span className="pill pill-amber">Cần kiểm tra</span>;
  if (state === "finalized") return <span className="pill pill-green">Đã chốt</span>;
  return <span className="pill pill-blue">Đã chấm AI</span>;
}

export function ExamQuestion({ question, showPoints = true }: { question: Question; showPoints?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Câu {question.id}</span>
        {showPoints ? <span className="meta">{formatPoints(question.max_points)} điểm</span> : null}
      </div>
      <MarkdownContent allowImages={false}>{question.prompt}</MarkdownContent>
      {Object.keys(question.options).length ? (
        <ul className="ml-1 grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
          {Object.entries(question.options).map(([letter, option]) => (
            <li key={letter} className="flex items-baseline gap-2">
              <strong>{letter}.</strong><MarkdownContent allowImages={false}>{option}</MarkdownContent>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ExamResult({ result }: { result: Submission }) {
  const { analysis, official } = result;
  const gradeById = new Map(analysis.grades.map((grade) => [grade.id, grade]));
  const answerById = new Map(analysis.answers.map((answer) => [answer.id, answer]));
  const officialById = new Map(official?.scores.map((score) => [score.id, score]));
  const reviewById = new Map((analysis.review_items ?? []).map((item) => [item.id, item.reason]));
  const partial = result.ai_total === null && analysis.grades.length > 0;
  const checkedOnly = result.ai_total === null && reviewById.size > 0;
  const correctCount = analysis.grades.filter((grade) => Number(grade.points) === Number(grade.max_points)).length;
  return (
    <div className="space-y-5">
      <div className="total pb-1">
        {result.ai_total !== null && !partial ? <span className="score-pen big">{formatPoints(result.ai_total)}</span> : null}
        <div className="min-w-0 flex-1">
          <h3>
            {partial ? `${correctCount} / ${analysis.grades.length} câu đúng`
              : result.ai_total === null ? "Chưa có điểm"
              : result.max_total !== null ? `trên ${formatPoints(result.max_total)} điểm` : "điểm"}
          </h3>
          <p className="meta">
            {partial ? "Kết quả các câu đã đối chiếu" : "Điểm AI đề xuất"}
            {result.kind ? `, ${kinds[result.kind].toLowerCase()}` : ""}
          </p>
          {partial ? <p className="meta">Đang chờ xác minh điểm toàn bài.</p> : null}
        </div>
        <ExamStatus state={result.state} />
      </div>

      {official ? (
        <div className="rounded-xl bg-[var(--accent-soft)] px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="size-4" /> Điểm chính thức</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPoints(official.total)}</p>
        </div>
      ) : null}
      {analysis.reason ? <p role="status" className="banner banner-info">{analysis.reason}</p> : null}
      {official?.comment ? (
        <div>
          <h4 className="font-semibold">Nhận xét của giáo viên</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm">{official.comment}</p>
        </div>
      ) : null}

      <ExamOriginals submissionId={result.id} files={result.files} />
      {analysis.pages.length ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-semibold"><ScanText className="mr-2 inline size-4" /> Nội dung nhận diện từ bản gốc</summary>
          <ul className="mt-3 space-y-3">
            {analysis.pages.map((page, index) => (
              <li key={index} className="rounded-lg bg-muted p-3">
                <p className="meta break-all">{fileRoles[page.role]} · {page.file} · Trang {page.page}</p>
                {page.readable ? null : <span className="pill pill-amber mt-1">Chưa đọc rõ</span>}
                {page.text ? <MarkdownContent allowImages={false}>{page.text}</MarkdownContent> : null}
                {page.choices.length ? (
                  <p className="meta mt-2">
                    Dấu chọn {page.choices.map((choice) => `Câu ${choice.label} · ${choice.selected_options.join(", ")}`).join(" / ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {analysis.questions.map((question) => {
        const grade = gradeById.get(question.id);
        const answer = answerById.get(question.id);
        const score = officialById.get(question.id);
        const review = reviewById.get(question.id);
        return (
          <article key={question.id} className="graded space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <ExamQuestion question={question} showPoints={!checkedOnly} />
              <div className="flex flex-wrap items-start gap-1.5">
                {grade ? <span className={`pill ${Number(grade.points) >= Number(grade.max_points) ? "pill-green" : Number(grade.points) > 0 ? "pill-amber" : "pill-red"}`}>{partial
                  ? (Number(grade.points) === Number(grade.max_points) ? "Đúng" : "Sai")
                  : `AI ${formatPoints(grade.points)} / ${formatPoints(grade.max_points)}`}</span> : null}
                {score ? <span className="pill pill-blue">Chính thức {formatPoints(score.points)} / {formatPoints(question.max_points)}</span> : null}
                {review ? <span className="pill pill-amber">Cần kiểm tra</span> : null}
              </div>
            </div>
            {review ? <p className="meta">{review}</p> : null}
            {answer ? (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">Bài làm nhận diện</p>
                {answer.status === "blank" ? <p>Bỏ trống</p> : answer.status === "unreadable" ? <p>Chưa đọc rõ</p> :
                  answer.selected_options.length ? <p>{answer.selected_options.join(", ")}</p> :
                    <MarkdownContent allowImages={false}>{answer.text}</MarkdownContent>}
                {answer.evidence ? <div className="meta mt-2 border-l-2 pl-2"><MarkdownContent allowImages={false}>{answer.evidence}</MarkdownContent></div> : null}
              </div>
            ) : null}
            {grade ? (
              <div className="space-y-2 text-sm">
                <span className="pill pill-grey">{sources[grade.source]}</span>
                {grade.correct_options.length ? <p><strong>Đáp án:</strong> {grade.correct_options.join(", ")}</p> : null}
                <MarkdownContent allowImages={false}>{grade.feedback}</MarkdownContent>
                {grade.criteria.length ? (
                  <ul className="space-y-2">
                    {grade.criteria.map((criterion, index) => (
                      <li key={index} className="rounded-lg border p-2.5">
                        <div className="flex flex-wrap justify-between gap-1 font-medium">
                          <MarkdownContent allowImages={false}>{criterion.label}</MarkdownContent>
                          <span>{formatPoints(criterion.points)} / {formatPoints(criterion.max_points)}</span>
                        </div>
                        {criterion.quote ? <blockquote className="quote"><span className="mark-hl">{criterion.quote}</span></blockquote> : null}
                        <MarkdownContent allowImages={false}>{criterion.feedback}</MarkdownContent>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div>
                  <p className="font-semibold">{Number(grade.points) < Number(grade.max_points) ? "Hướng dẫn sửa" : "Lời giải tham khảo"}</p>
                  <MarkdownContent allowImages={false}>{grade.correction}</MarkdownContent>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
