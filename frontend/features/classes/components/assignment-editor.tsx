"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { examApi, type Assignment, type TeacherQuestion } from "@/features/essay/services/exam-api";

type Draft = {
  key: number;
  kind: "choice" | "written";
  prompt: string;
  points: string;
  options: string;
  selection: string;
  solution: string;
  rubric: { label: string; points: string }[];
};

function newQuestion(key: number): Draft {
  return { key, kind: "choice", prompt: "", points: "1", options: "", selection: "", solution: "", rubric: [{ label: "", points: "1" }] };
}

function toQuestion(draft: Draft, index: number): TeacherQuestion {
  const choices = draft.kind === "choice"
    ? draft.options.split("\n").map((line) => line.trim()).filter(Boolean) : [];
  const keys = draft.kind === "choice" ? draft.selection.toUpperCase().split(/[\s,;]+/).filter(Boolean) : [];
  const rubric = draft.kind === "written"
    ? draft.rubric.map((item) => ({ label: item.label.trim(), max_points: item.points })) : [];
  if ((draft.kind === "choice" && (choices.length < 2 || choices.length > 12 || !keys.length))
    || (draft.kind === "written" && rubric.some((item) => !item.label))) {
    throw new Error(`Câu ${index + 1} cần phương án và đáp án hoặc barem đầy đủ.`);
  }
  return {
    id: String(index + 1), prompt: draft.prompt.trim(), max_points: draft.points,
    options: Object.fromEntries(choices.map((choice, i) => [String.fromCharCode(65 + i), choice])),
    correct_options: keys, rubric,
    solution: draft.solution.trim() || (keys.length ? `Đáp án: ${keys.join(", ")}` : rubric.map((item) => item.label).join("\n")),
  };
}

export function AssignmentEditor({
  classId, onCreated, onCancel,
}: { classId: string; onCreated: (data: Assignment) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<Draft[]>([newQuestion(1)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function change(key: number, delta: Partial<Draft>) {
    setQuestions((items) => items.map((item) => item.key === key ? { ...item, ...delta } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onCreated(await examApi.create(classId, { title: title.trim(), questions: questions.map(toQuestion) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa giao được đề thi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="editor space-y-4" onSubmit={submit}>
      <h3 className="block-title">Tạo đề và barem</h3>
      <fieldset disabled={busy} className="space-y-4">
        <label className="lbl">
          Tên đề
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />
        </label>
        {questions.map((question, index) => (
          <fieldset key={question.key} className="q-card space-y-3">
            <legend className="q-head"><span className="q-num">Câu {index + 1}</span></legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="lbl grow">
                Loại câu
                <select className="input" aria-label={`Loại câu ${index + 1}`} value={question.kind}
                  onChange={(event) => change(question.key, { kind: event.target.value as Draft["kind"] })}>
                  <option value="choice">Trắc nghiệm</option><option value="written">Tự luận</option>
                </select>
              </label>
              <label className="lbl w-28">
                Điểm tối đa
                <input className="input" aria-label={`Điểm tối đa câu ${index + 1}`} type="number" min="0.01" max="100" step="0.01" required
                  value={question.points} onChange={(event) => change(question.key, { points: event.target.value })} />
              </label>
              <Button type="button" size="icon" variant="ghost" disabled={questions.length === 1}
                onClick={() => setQuestions((items) => items.filter((item) => item.key !== question.key))}
                aria-label={`Xóa câu ${index + 1}`}
              ><Trash2 /></Button>
            </div>
            <label className="lbl">
              Nội dung câu hỏi
              <textarea className="input" aria-label={`Nội dung câu hỏi ${index + 1}`} rows={3} required value={question.prompt}
                onChange={(event) => change(question.key, { prompt: event.target.value })} />
            </label>
            {question.kind === "choice" ? (
              <>
                <label className="lbl">
                  Phương án theo thứ tự A, B, C…
                  <textarea className="input" rows={3} required value={question.options}
                    placeholder="Mỗi dòng một phương án" onChange={(event) => change(question.key, { options: event.target.value })} />
                </label>
                <label className="lbl">
                  Phương án đúng
                  <input className="input uppercase placeholder:normal-case" required value={question.selection} placeholder="Ví dụ A hoặc A, C"
                    onChange={(event) => change(question.key, { selection: event.target.value })} />
                </label>
              </>
            ) : (
              <div className="space-y-2">
                <p className="lbl">Barem từng tiêu chí</p>
                {question.rubric.map((criterion, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <input className="input min-w-0 flex-1" aria-label={`Tiêu chí ${i + 1}`} required
                      placeholder="Tiêu chí" value={criterion.label} onChange={(event) => change(question.key, {
                        rubric: question.rubric.map((item, j) => j === i ? { ...item, label: event.target.value } : item),
                      })} />
                    <input className="input !w-20" aria-label={`Điểm tối đa tiêu chí ${i + 1}`} type="number"
                      required min="0.01" max="100" step="0.01" value={criterion.points} onChange={(event) => change(question.key, {
                        rubric: question.rubric.map((item, j) => j === i ? { ...item, points: event.target.value } : item),
                      })} />
                    <Button type="button" size="icon" variant="ghost" disabled={question.rubric.length === 1}
                      aria-label={`Xóa tiêu chí ${i + 1}`} onClick={() => change(question.key, { rubric: question.rubric.filter((_, j) => j !== i) })}
                    ><Trash2 /></Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" disabled={question.rubric.length >= 12}
                  onClick={() => change(question.key, { rubric: [...question.rubric, { label: "", points: "1" }] })}
                ><Plus /> Thêm tiêu chí</Button>
              </div>
            )}
            <label className="lbl">
              Lời giải tham khảo <span className="meta">Tuỳ chọn</span>
              <textarea className="input" rows={2} value={question.solution}
                onChange={(event) => change(question.key, { solution: event.target.value })} />
            </label>
          </fieldset>
        ))}
        <Button type="button" variant="outline" disabled={questions.length >= 50}
          onClick={() => setQuestions((items) => [...items, newQuestion(Math.max(...items.map((item) => item.key)) + 1)])}
        ><Plus /> Thêm câu hỏi</Button>
      </fieldset>
      {error ? <p role="alert" className="error-box">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Đang giao đề…" : "Giao đề cho lớp"}</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Hủy</Button>
      </div>
    </form>
  );
}
