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
    <div>
      <div className="view-head">
        <h2>Chấm bài thi</h2>
        <p>Chấm trắc nghiệm và tự luận từ ảnh hoặc PDF, xem cách sửa từng câu.</p>
      </div>
      <Tabs defaultValue="files">
        <TabsList className="mb-4">
          <TabsTrigger value="files">Tải đề và bài làm</TabsTrigger>
          <TabsTrigger value="typed">Tự luận nhập tay</TabsTrigger>
        </TabsList>
        <TabsContent value="files"><PersonalExams /></TabsContent>
        <TabsContent value="typed"><TypedEssay /></TabsContent>
      </Tabs>
    </div>
  );
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

  const textareaClass = "input" as const;

  return (
    <div>
      <div style={{ marginTop: 24, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <section className="card">
          <label className="field">
            Đề bài
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={textareaClass} />
          </label>
          <label className="field">
            Barem — mỗi dòng một tiêu chí
            <textarea value={rubric} onChange={(e) => setRubric(e.target.value)} rows={5} className={textareaClass} />
            <span className="meta">Định dạng: tên tiêu chí - số điểm.</span>
          </label>
          <label className="field">
            Bài làm
            <textarea value={essay} onChange={(e) => setEssay(e.target.value)} rows={6} className={textareaClass} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
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

        <section className="card">
          <div className="label" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-strong)" }}>
            <PenLine className="size-4" /> Kết quả chấm
          </div>
          {!result ? (
            <div className="empty" style={{ marginTop: 16 }}>
              <PenLine className="mx-auto mb-2 size-7" style={{ color: "var(--muted)" }} />
              <h3>Chưa chấm bài nào</h3>
              <p>Nhập đề, barem và bài làm rồi bấm “Chấm bài này” để xem điểm và nhận xét theo từng tiêu chí.</p>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <span style={{ fontSize: 36, fontWeight: 700, fontFamily: "Lexend, sans-serif" }}>
                  {result.total.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}
                </span>
                <span className="meta">
                  / {result.max_total} điểm · {gradeMethods[result.mode]}
                </span>
              </div>
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                {result.scores.map((s) => (
                  <div key={s.criterion} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12 }}>
                    <div className="row-between" style={{ fontSize: 14 }}>
                      <span className="title">{s.criterion}</span>
                      <span style={{ fontWeight: 600, color: "var(--accent-strong)" }}>{s.score} / {s.max}</span>
                    </div>
                    {s.quote ? (
                      <p style={{ marginTop: 8, background: "var(--surface-2)", borderRadius: 8, padding: 8, fontSize: 12, fontStyle: "italic", color: "var(--ink-2)" }}>
                        “{s.quote}”
                      </p>
                    ) : null}
                    {s.feedback ? <p className="meta" style={{ marginTop: 8, fontSize: 12 }}>{s.feedback}</p> : null}
                  </div>
                ))}
              </div>
              {result.overall ? (
                <p style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16, fontSize: 14 }}>{result.overall}</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
