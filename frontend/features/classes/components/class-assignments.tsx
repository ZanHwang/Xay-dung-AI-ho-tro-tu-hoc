"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ClipboardList, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExamFilePicker } from "@/features/essay/components/exam-files";
import { ExamQuestion, ExamResult, ExamStatus, formatPoints } from "@/features/essay/components/exam-result";
import { examApi, type Assignment, type AssignmentSummary, type Submission, type SubmissionSummary } from "@/features/essay/services/exam-api";
import { MarkdownContent } from "@/features/tutor/components/markdown-content";
import { AssignmentEditor } from "./assignment-editor";
import { TeacherExamReview } from "./teacher-exam-review";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function AssignmentPreview({ assignment }: { assignment: Assignment }) {
  return (
    <details className="exam-paper" open>
      <summary>
        Đề thi, {assignment.question_count} câu, {formatPoints(assignment.max_total)} điểm
      </summary>
      <div>
        {assignment.questions.map((question) => (
          <div key={question.id} className="graded space-y-2 pb-3">
            <ExamQuestion question={question} />
            {"solution" in question ? (
              <div className="answer-key">
                {question.correct_options.length ? (
                  <p><strong>Đáp án:</strong> {question.correct_options.join(", ")}</p>
                ) : (
                  <>
                    <p className="font-semibold">Barem</p>
                    <ul className="ml-4 list-disc">
                      {question.rubric.map((criterion, index) => (
                        <li key={index}>
                          <MarkdownContent allowImages={false}>{criterion.label}</MarkdownContent>
                          <span className="meta">{formatPoints(criterion.max_points)} điểm</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <MarkdownContent allowImages={false}>{question.solution}</MarkdownContent>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function StudentSubmission({
  classId, assignmentId, submissionId, onSubmitted,
}: { classId: string; assignmentId: string; submissionId: string | null; onSubmitted: (id: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!submissionId) return;
    let current = true;
    examApi.submission(submissionId).then((data) => {
      if (current) {
        setResult(data);
        setError("");
      }
    }).catch((err: unknown) => {
      if (current) setError(errorText(err, "Không tải được bài nộp."));
    });
    return () => { current = false; };
  }, [submissionId, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const submission = await examApi.submitClasswork(classId, assignmentId, files);
      setResult(submission);
      onSubmitted(submission.id);
    } catch (err) {
      setError(errorText(err, "Chưa nộp được bài."));
    } finally {
      setBusy(false);
    }
  }

  if (result) return (
    <div className="space-y-3">
      {!result.official ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>Cập nhật kết quả</Button>
      ) : null}
      {error ? <p role="alert" className="error-box">{error}</p> : null}
      <div className="exam-paper">
        <ExamResult result={result} />
      </div>
    </div>
  );
  if (submissionId) return error ? <p role="alert" className="error-box">{error}</p> : <p role="status" className="meta">Đang tải bài đã nộp…</p>;
  return (
    <form className="space-y-3" onSubmit={submit}>
      <ExamFilePicker label="Bài làm của bạn" tone="cover-violet" files={files} onChange={setFiles} disabled={busy} />
      <Button type="submit" disabled={!files.length || busy}><Sparkles /> {busy ? "Đang nhận diện và chấm…" : "Nộp bài để AI chấm"}</Button>
      {error ? <p role="alert" className="error-box">{error}</p> : null}
    </form>
  );
}

function TeacherSubmissions({ classId, assignment }: { classId: string; assignment: Assignment }) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[] | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    examApi.classSubmissions(classId, assignment.id).then((data) => {
      if (current) {
        setSubmissions(data);
        setListError("");
      }
    }).catch((err: unknown) => {
      if (current) setListError(errorText(err, "Không tải được bài nộp."));
    });
    return () => { current = false; };
  }, [classId, assignment.id, refresh]);

  useEffect(() => {
    if (!focusedId) return;
    let current = true;
    examApi.submission(focusedId).then((data) => {
      if (current) {
        setResult((previous) => previous?.id === data.id && previous.revision > data.revision ? previous : data);
        setDetailError("");
      }
    }).catch((err: unknown) => {
      if (current) setDetailError(errorText(err, "Không tải được bài làm."));
    });
    return () => { current = false; };
  }, [focusedId, refresh]);

  function updateResult(submission: Submission) {
    setResult((previous) => previous?.id === submission.id ? submission : previous);
    setSubmissions((items) => items?.map((item) => item.id === submission.id
      ? { ...submission, student_name: item.student_name } : item) ?? null);
  }

  return (
    <div className="space-y-3">
      <div className="block-head">
        <h4 className="mr-auto">Bài nộp {submissions ? `(${submissions.length})` : ""}</h4>
        <Button type="button" variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button>
      </div>
      {listError ? <p role="alert" className="error-box">{listError}</p> : null}
      {!submissions && !listError ? <p role="status" className="meta">Đang tải bài nộp…</p> : null}
      {submissions?.length === 0 ? <p className="meta">Chưa có học sinh nộp bài.</p> : null}
      <ul className="work-list">
        {submissions?.map((submission) => (
          <li key={submission.id}>
            <button type="button" className="work-row"
              aria-pressed={focusedId === submission.id}
              onClick={() => {
                if (focusedId === submission.id) return;
                setResult(null);
                setDetailError("");
                setFocusedId(submission.id);
              }}
            >
              <span className="grow">
                <span className="name">{submission.student_name}</span>
                <span className="meta">
                  {submission.official_total !== null ? `Chính thức ${formatPoints(submission.official_total)} điểm` :
                    submission.ai_total !== null ? `AI ${formatPoints(submission.ai_total)} điểm` : "Chưa có điểm"}
                </span>
              </span>
              <ExamStatus state={submission.state} />
            </button>
          </li>
        ))}
      </ul>
      {detailError ? <p role="alert" className="error-box">{detailError}</p> : null}
      {focusedId && !result && !detailError ? <p role="status" className="meta">Đang tải bài làm…</p> : null}
      {result ? (
        <div className="exam-paper">
        <TeacherExamReview
          key={`${result.id}:${result.revision}`} classId={classId} assignment={assignment} submission={result}
          onChange={updateResult} onRefresh={() => setRefresh((value) => value + 1)}
        />
        </div>
      ) : null}
    </div>
  );
}

function AssignmentWorkspace({
  classId, summary, asTeacher, canSubmit, onSubmitted,
}: {
  classId: string; summary: AssignmentSummary; asTeacher: boolean; canSubmit: boolean; onSubmitted: (id: string) => void;
}) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    examApi.assignment(classId, summary.id).then((data) => {
      if (current) setAssignment(data);
    }).catch((err: unknown) => {
      if (current) setError(errorText(err, "Không tải được đề thi."));
    });
    return () => { current = false; };
  }, [classId, summary.id]);

  if (!assignment) return error ? <p role="alert" className="error-box">{error}</p> : <p role="status" className="meta">Đang tải đề thi…</p>;
  return (
    <div className="space-y-4">
      <h3 className="block-title break-words">{assignment.title}</h3>
      <AssignmentPreview assignment={assignment} />
      {asTeacher ? <TeacherSubmissions classId={classId} assignment={assignment} /> :
        canSubmit ? (
          <StudentSubmission
            classId={classId} assignmentId={assignment.id} submissionId={summary.submission_id} onSubmitted={onSubmitted}
          />
        ) : null}
    </div>
  );
}

export function ClassAssignments({
  classId, asTeacher, canSubmit,
}: { classId: string; asTeacher: boolean; canSubmit: boolean }) {
  const [assignments, setAssignments] = useState<AssignmentSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    examApi.assignments(classId).then((data) => {
      if (current) setAssignments(data);
    }).catch((err: unknown) => {
      if (current) setError(errorText(err, "Không tải được đề đã giao."));
    });
    return () => { current = false; };
  }, [classId]);
  const summary = assignments?.find((item) => item.id === selected);

  return (
    <section className="min-w-0 space-y-4">
      <div className="block-head !mb-0">
        <h3 className="block-title mr-auto">Đề đã giao</h3>
        {asTeacher && !creating && assignments ? <Button type="button" onClick={() => setCreating(true)}><Plus /> Tạo đề</Button> : null}
      </div>
      {error ? <p role="alert" className="error-box">{error}</p> : null}
      {!assignments && !error ? <p role="status" className="meta">Đang tải đề…</p> : null}
      {assignments?.length === 0 && !creating ? <p className="empty">Lớp chưa có đề thi.</p> : null}
      {creating ? (
        <AssignmentEditor
          classId={classId} onCancel={() => setCreating(false)}
          onCreated={(assignment) => {
            setAssignments((items) => [assignment, ...(items ?? [])]);
            setSelected(assignment.id);
            setCreating(false);
          }}
        />
      ) : null}
      {assignments?.length ? (
        <ul className="work-list">
          {assignments.map((item) => (
            <li key={item.id}>
              <button type="button" aria-pressed={selected === item.id}
                onClick={() => { setSelected(item.id); setCreating(false); }}
                className="work-row"
              >
                <span className="file-ic cover-amber" aria-hidden="true"><ClipboardList className="size-5" /></span>
                <span className="grow">
                  <span className="name">{item.title}</span>
                  <span className="meta">{item.question_count} câu, {formatPoints(item.max_total)} điểm</span>
                </span>
                {item.submission_id ? <span className="pill pill-green">Đã nộp</span> : null}
                {item.submission_count !== null ? <span className="pill pill-grey">{item.submission_count} bài nộp</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {summary && !creating ? (
        <AssignmentWorkspace
          key={summary.id} classId={classId} summary={summary} asTeacher={asTeacher} canSubmit={canSubmit}
          onSubmitted={(id) => setAssignments((items) => items?.map((item) => item.id === summary.id
            ? { ...item, submission_id: id } : item) ?? null)}
        />
      ) : null}
    </section>
  );
}
