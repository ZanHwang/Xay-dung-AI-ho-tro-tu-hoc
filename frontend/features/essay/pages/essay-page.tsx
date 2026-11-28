"use client";

import { useState } from "react";
import { PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalExams } from "../components/personal-exams";
import { essayApi, type EssayGrade } from "../services/essay-api";

// Pre-filled with v2's sample so the form is usable out of the box; the
// rubric accepts either a JSON array or the one-"Ý - Nđ"-per-line string.
const SAMPLE_PROMPT = "Trình bày vai trò của quang hợp đối với sự sống trên Trái Đất.";
const SAMPLE_RUBRIC = [
  "Nêu đúng khái niệm quang hợp - 2đ",
  "Phân tích vai trò với cây xanh và môi trường - 3đ",
  "Liên hệ thực tế, lấy ví dụ - 2đ",
  "Trình bày rõ ràng, đúng chính tả - 1đ",
].join("\n");
const SAMPLE_ESSAY =
  "Quang hợp là quá trình cây xanh dùng năng lượng ánh sáng để tổng hợp chất hữu cơ từ nước và khí cacbonic. Nhờ quang hợp, cây tạo ra oxi cho con người hít thở và tạo ra thức ăn cho các sinh vật khác. Nếu không có quang hợp, sự sống trên Trái Đất sẽ không duy trì được.";

const gradeMethods: Record<EssayGrade["mode"], string> = {
  calculation: "Đối chiếu kết quả phép tính",
  llm: "Chấm bằng AI theo barem",
  fallback: "Chấm tạm (chưa có LLM)",
};

export function EssayPage() {
  return (
    <div className="page">
      <Tabs defaultValue="files">
        <div className="view-head title-row">
          <div>
            <h1>Chấm bài</h1>
            <p>Chấm trắc nghiệm và tự luận, xem cách sửa từng câu.</p>
          </div>
          <TabsList className="segmented" aria-label="Cách nộp bài">
            <TabsTrigger value="files">Gửi tệp</TabsTrigger>
            <TabsTrigger value="typed">Gõ trực tiếp</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="files"><PersonalExams /></TabsContent>
        <TabsContent value="typed"><TypedEssay /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Color of a score tag: full marks, part of them, or none. */
function scoreTone(score: number, max: number) {
  if (score >= max) return "pill-green";
  return score > 0 ? "pill-amber" : "pill-red";
}

function TypedEssay() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [rubric, setRubric] = useState(SAMPLE_RUBRIC);
  const [essay, setEssay] = useState(SAMPLE_ESSAY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EssayGrade | null>(null);

  async function grade() {
    setBusy(true);
    setError("");
    try {
      // Send the rubric as the multi-line string the backend parser understands.
      setResult(await essayApi.grade({ prompt, rubric, essay }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chấm bài thất bại.");
    } finally {
      setBusy(false);
    }
  }

  const fillSample = () => {
    setPrompt(SAMPLE_PROMPT);
    setRubric(SAMPLE_RUBRIC);
    setEssay(SAMPLE_ESSAY);
  };

  return (
    <div className="two-col">
      <section className="panel">
        <h2>Bài cần chấm</h2>
        <label className="field">
          Đề bài
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className="input" />
        </label>
        <label className="field">
          Barem, mỗi dòng một tiêu chí
          <textarea value={rubric} onChange={(e) => setRubric(e.target.value)} rows={5} className="input" />
          <span className="meta">Định dạng: tên tiêu chí - số điểm.</span>
        </label>
        <label className="field">
          Bài làm
          <textarea value={essay} onChange={(e) => setEssay(e.target.value)} rows={6} className="input" />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void grade()} disabled={busy || !essay.trim()}>
            {busy ? "Đang chấm…" : <><Sparkles /> Chấm bài này</>}
          </Button>
          <Button variant="outline" onClick={fillSample}>Điền bài mẫu</Button>
        </div>
        {error ? (
          <div role="alert" className="error-box" style={{ marginTop: 12 }}>
            <p>{error}</p>
          </div>
        ) : null}
      </section>

      <section className="panel" aria-label="Kết quả chấm">
        {!result ? (
          <div className="empty">
            <PenLine className="mb-2 size-7" style={{ color: "var(--muted)" }} aria-hidden="true" />
            <h3>Chưa chấm bài nào</h3>
            <p>Nhập đề, barem và bài làm rồi bấm “Chấm bài này” để xem điểm và nhận xét theo từng tiêu chí.</p>
          </div>
        ) : (
          <>
            <div className="total mb-4">
              <span className="score-pen big">
                {result.total.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}
              </span>
              <div>
                <h3>trên {result.max_total} điểm</h3>
                <span className="pill pill-blue">{gradeMethods[result.mode]}</span>
              </div>
            </div>
            {result.scores.map((s) => (
              <div key={s.criterion} className="graded">
                <div className="flex items-start justify-between gap-3">
                  <b>{s.criterion}</b>
                  <span className={`pill ${scoreTone(s.score, s.max)}`}>{s.score} / {s.max}</span>
                </div>
                {s.quote ? <p className="quote"><span className="mark-hl">{s.quote}</span></p> : null}
                {s.feedback ? <p className="mt-1">{s.feedback}</p> : null}
              </div>
            ))}
            {result.overall ? <p className="graded">{result.overall}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
