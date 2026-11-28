import Link from "next/link";
import { ArrowRight, BookOpen, Check, Lock } from "lucide-react";
import { DeskStrip } from "@/components/shared/desk-strip";

// Short marketing page in the app's notebook style. It only describes what the
// app really does; the pictures are drawn with the app's own classes and use
// made-up example data.

function AskSample() {
  return (
    <div className="sample">
      <p className="bubble bubble-user">Pha tối diễn ra ở đâu?</p>
      <p>Pha tối diễn ra ở <b>chất nền lục lạp</b>, dùng năng lượng do pha sáng tạo ra.</p>
      <p className="sample-src">Nguồn: <span className="mark-hl">Chương 2 - Quang hợp.pdf, trang 6</span></p>
    </div>
  );
}

function PathSample() {
  const stops = [
    { label: "Khái niệm", state: "done" },
    { label: "Pha sáng", state: "done" },
    { label: "Pha tối", state: "current" },
    { label: "Yếu tố ảnh hưởng", state: "locked" },
  ];
  return (
    <ol className="road">
      {stops.map((stop, index) => (
        <li key={stop.label} className={`stop ${stop.state}`}>
          <i aria-hidden="true">
            {stop.state === "done" ? <Check className="size-5" /> : stop.state === "locked" ? <Lock className="size-4" /> : index + 1}
          </i>
          <b>{stop.label}</b>
        </li>
      ))}
    </ol>
  );
}

function ReviewSample() {
  return (
    <div className="sample">
      <p><b>Mỗi lần trả lời đúng, câu hỏi quay lại sau lâu hơn</b></p>
      <ol className="intervals">
        {["1 giờ", "4 giờ", "1 ngày", "3 ngày", "7 ngày", "14 ngày", "30 ngày"].map((gap) => <li key={gap}>{gap}</li>)}
      </ol>
      <p className="sample-src">Trả lời sai thì bắt đầu lại từ 1 giờ.</p>
    </div>
  );
}

function GradeSample() {
  return (
    <div className="sample">
      <div className="total">
        <span className="score-pen big">6,5</span>
        <b>trên 8 điểm</b>
      </div>
      <dl className="criteria">
        <div><dt>Nêu đúng khái niệm</dt><dd>2 / 2</dd></div>
        <div><dt>Phân tích vai trò</dt><dd>3,5 / 4</dd></div>
        <div><dt>Lấy ví dụ thực tế</dt><dd>1 / 2</dd></div>
      </dl>
    </div>
  );
}

function ClassSample() {
  return (
    <div className="sample class-sample">
      <p className="code-card cover-cyan"><span>Mã lớp</span><b>QH7K2M</b></p>
      <dl className="criteria">
        <div><dt>Lê Thu Hà</dt><dd><span className="pill pill-green">Đã chốt</span></dd></div>
        <div><dt>Trần Gia Bảo</dt><dd><span className="pill pill-amber">Cần kiểm tra</span></dd></div>
      </dl>
    </div>
  );
}

const features = [
  { title: "Hỏi đáp trên tài liệu của bạn", text: "Tải tài liệu PDF lên rồi hỏi. Câu trả lời kèm tên tài liệu và số trang; khi AI dùng kiến thức chung thì ghi rõ.", Sample: AskSample },
  { title: "Lộ trình theo từng tài liệu", text: "Mỗi tài liệu được chia thành các chủ đề. Đạt 70% bài luyện tập thì mở chủ đề tiếp theo.", Sample: PathSample },
  { title: "Quiz và nhắc ôn đúng hạn", text: "Tạo quiz từ tài liệu. Những câu đã làm được nhắc lại thưa dần, đến hạn thì hiện ngay trên trang đầu.", Sample: ReviewSample },
  { title: "Chấm bài có giải thích", text: "Gửi ảnh hoặc PDF bài trắc nghiệm, tự luận, hay gõ thẳng bài viết vào. AI chấm từng phần và chỉ chỗ cần sửa.", Sample: GradeSample },
  { title: "Lớp học cho giáo viên", text: "Tạo lớp, gửi mã cho học sinh và giao đề. AI chấm trước, giáo viên xem lại rồi chốt điểm.", Sample: ClassSample },
];

const covers = [
  { name: "Sinh học 12", tone: "cover-emerald" },
  { name: "Giải tích 1", tone: "cover-cyan" },
  { name: "Ngữ văn 12", tone: "cover-amber" },
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="landing-top-inner">
          <Link href="/" className="brand" aria-label="TuHoc">
            <span className="brand-mark" aria-hidden="true">
              <BookOpen className="size-4" />
            </span>
            <span>TuHoc</span>
          </Link>
          <nav aria-label="Tài khoản" className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">Đăng nhập</Link>
            <Link href="/register" className="btn btn-accent btn-sm">Tạo tài khoản</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div>
            <h1>Học từ chính <span className="mark-hl">tài liệu của bạn</span></h1>
            <p className="lede">
              Tải tài liệu lên, hỏi đáp có trang nguồn, học theo lộ trình, làm quiz và được nhắc ôn đúng hạn.
            </p>
            <div className="hero-actions">
              <Link href="/register" className="btn btn-accent">
                Tạo tài khoản <ArrowRight className="size-4" />
              </Link>
              <Link href="/login" className="btn btn-outline">Đăng nhập</Link>
            </div>
          </div>

          <figure className="peek">
            <div className="peek-window" aria-hidden="true">
              <div className="peek-side">
                <b>TuHoc</b>
                {["Hôm nay", "Hỏi AI", "Chấm bài", "Lớp học"].map((item, index) => (
                  <span key={item} className={index === 0 ? "on" : undefined}>{item}</span>
                ))}
              </div>
              <div className="peek-page">
                <p className="peek-hello">Chào Minh Anh</p>
                <div className="peek-tasks">
                  <p className="cover-amber"><b>7 câu đến hạn ôn</b></p>
                  <p className="cover-cyan"><b>Học tiếp: Pha tối</b></p>
                </div>
                <div className="peek-covers">
                  {covers.map((cover) => (
                    <p key={cover.name} className={cover.tone}><span>{cover.name}</span></p>
                  ))}
                </div>
              </div>
            </div>
            <figcaption>Hình minh họa trang Hôm nay, dữ liệu ví dụ.</figcaption>
          </figure>
        </section>

        <section className="landing-features" aria-labelledby="features-title">
          <h2 id="features-title">TuHoc giúp bạn làm gì</h2>
          {features.map(({ title, text, Sample }) => (
            <article key={title} className="feature">
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              <Sample />
            </article>
          ))}
        </section>

        <section className="landing-cta">
          <h2>Bắt đầu với tài liệu đầu tiên</h2>
          <Link href="/register" className="btn btn-accent">Tạo tài khoản</Link>
        </section>
      </main>

      <DeskStrip />
      <footer className="landing-footer">
        <span>TuHoc, học từ tài liệu của bạn</span>
        <Link href="/login" className="btn btn-ghost btn-sm">Đăng nhập</Link>
      </footer>
    </div>
  );
}
