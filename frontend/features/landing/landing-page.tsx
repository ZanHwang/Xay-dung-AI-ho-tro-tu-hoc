import Link from "next/link";
import {
  ArrowRight, BellRing, BookOpen, Bot, Check, PenLine, Star, Users,
} from "lucide-react";

// v2 marketing layout: hero "Miễn phí. Vui. Hiệu quả.", ba bước cách làm,
// feature xen kẽ (RAG / nhắc ôn / barem / quiz), preview 10 môn, bảng giá,
// CTA band. Dùng lớp v2 thuần — không Tailwind hardcoded màu.
const steps = [
  { num: "1", title: "Đẩy tài liệu lên", desc: "Tải PDF, Word hoặc dán ghi chép. TuHoc chia theo chương và lập chỉ mục để hỏi đáp ngay." },
  { num: "2", title: "Học theo lộ trình", desc: "Mỗi chương thành một đường đi gồm các bài 5 phút. Làm xong bài này mới mở bài sau." },
  { num: "3", title: "Được chấm và nhắc ôn", desc: "Quiz ra điểm và giải thích ngay. Tự luận chấm theo barem; câu sai (và cả câu đúng) được nhắc ôn lại sau 1, 3, 7 ngày." },
];

const features = [
  { icon: Bot, title: "Hỏi đúng tài liệu của bạn", desc: "Trò chuyện nhưng TuHoc chỉ trả lời từ tài liệu bạn đã đẩy lên và trích đúng đoạn nguồn. Không bịa.", flip: false },
  { icon: BellRing, title: "Nhắc ôn lại đúng lúc", desc: "Mỗi câu đã làm được lên lịch ôn lại sau 1, 3, 7 ngày (đúng hay sai đều có lịch riêng). Chuông nhắc hiện ngay khi có câu đến hạn.", flip: true },
  { icon: PenLine, title: "Chấm tự luận theo barem", desc: "Nhập đề và barem, TuHoc chấm từng tiêu chí, trích đúng câu trong bài và gợi ý cách sửa để đủ điểm.", flip: false },
  { icon: Check, title: "Quiz khó dần theo trình độ", desc: "Câu hỏi lấy từ tài liệu của bạn, khó dần theo mức nắm vững; câu sai quay lại sau 1, 3 và 7 ngày.", flip: true },
];

const heroFacts = [
  { num: "5 phút", label: "mỗi bài học" },
  { num: "1 · 3 · 7", label: "ngày nhắc ôn lại câu sai" },
  { num: "Miễn phí", label: "không cần thẻ" },
];

const pricing = [
  {
    name: "Miễn phí",
    price: "0đ",
    note: "Cho học sinh mới bắt đầu",
    featured: false,
    cta: "Bắt đầu học miễn phí",
    perks: ["1 môn học", "100 trang tài liệu", "10 câu quiz mỗi ngày", "1 bài tự luận mỗi tuần"],
  },
  {
    name: "Pro",
    price: "49.000đ",
    period: "/ tháng",
    note: "Cho học sinh ôn thi nghiêm túc",
    featured: true,
    cta: "Dùng thử Pro",
    perks: ["Không giới hạn môn và tài liệu", "Quiz không giới hạn", "Chấm tự luận mỗi ngày", "Nhắc ôn đầy đủ sau 1, 3, 7 ngày"],
  },
  {
    name: "Lớp học",
    price: "199.000đ",
    period: "– 299.000đ / tháng",
    note: "Cho giáo viên và trung tâm",
    featured: false,
    cta: "Tạo lớp học",
    perks: ["Tạo lớp và giao bài", "Chấm hàng loạt theo barem", "Bảng xếp hạng tuần", "Báo cáo cho phụ huynh"],
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="landing-top">
        <div className="landing-top-inner">
          <Link href="/" className="brand" aria-label="TuHoc">
            <span className="brand-mark" aria-hidden="true">
              <BookOpen className="size-4" />
            </span>
            <span>TuHoc</span>
          </Link>
          <nav aria-label="Điều hướng trang giới thiệu" className="flex items-center gap-5 text-sm">
            <a href="#features" className="hidden text-ink-2 hover:text-ink sm:inline" style={{ color: "var(--ink-2)" }}>Tính năng</a>
            <a href="#pricing" className="hidden text-ink-2 hover:text-ink sm:inline" style={{ color: "var(--ink-2)" }}>Giá</a>
            <Link href="/login" className="btn btn-ghost btn-sm">Đăng nhập</Link>
            <Link href="/register" className="btn btn-accent btn-sm">Bắt đầu học miễn phí</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="landing-hero">
          <div>
            <p className="label" style={{ color: "var(--accent-strong)" }}>Học từ chính tài liệu của bạn</p>
            <h1 className="mt-4">
              Miễn phí<span className="dot-accent">.</span> Vui<span className="dot-accent">.</span> Hiệu quả<span className="dot-accent">.</span>
            </h1>
            <p className="lede">
              Đẩy sách giáo khoa và ghi chép lên, hỏi đáp trực tiếp trên tài liệu, làm quiz theo từng chương và được chấm tự luận đúng barem của giáo viên.
            </p>
            <div className="hero-actions">
              <Link href="/register" className="btn btn-accent">
                Bắt đầu học miễn phí <ArrowRight className="size-4" />
              </Link>
              <Link href="/login" className="btn btn-outline">Đăng nhập</Link>
            </div>
            <div className="hero-facts">
              {heroFacts.map((f) => (
                <div key={f.label} className="fact">
                  <b>{f.num}</b>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual: path node + RAG answer card */}
          <div className="hero-visual">
            <div className="hero-card">
              <div className="hv-head">
                <b>Sinh 12 · Chương 2: Quang hợp</b>
                <span className="pill pill-amber">
                  <Check className="size-3.5" /> 2/3 bài đã học
                </span>
              </div>
              <div className="hv-nodes">
                {[
                  { label: "Khái niệm", state: "done" },
                  { label: "Pha sáng", state: "done" },
                  { label: "Pha tối", state: "current" },
                ].map((node, i) => (
                  <div key={node.label} className="flex items-center">
                    {i > 0 && <span className={`hv-link ${node.state === "done" ? "done" : ""}`} />}
                    <div className="hv-node">
                      <span
                        className={`node-circle ${
                          node.state === "done" ? "done" : node.state === "current" ? "current" : ""
                        }`}
                      >
                        {node.state === "done" ? <Check className="size-5" /> : i + 1}
                      </span>
                      <span>{node.label}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hv-chat">
                <p className="text-sm font-semibold">Quang hợp là gì?</p>
                <div className="mini-row" style={{ borderTop: "none" }}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-lg" style={{ background: "var(--surface-2)", color: "var(--accent-strong)" }}>
                    <Bot className="size-4" />
                  </span>
                  <span className="meta grow">
                    Quá trình cây xanh dùng năng lượng ánh sáng để tổng hợp chất hữu cơ từ nước và khí cacbonic, diễn ra ở lá trong lục lạp.
                  </span>
                </div>
                <p className="meta" style={{ marginTop: 8 }}>
                  <strong className="text-foreground">Nguồn:</strong> Sinh học 12, Chương 2, trang 42. Trả lời chỉ từ tài liệu bạn đã đẩy lên.
                </p>
                <div className="grid grid-cols-3 gap-3 text-center text-xs" style={{ marginTop: 16 }}>
                  <div className="card" style={{ padding: 12 }}>
                    <Star className="mx-auto size-4" style={{ color: "var(--accent)" }} />
                    <p className="num font-semibold" style={{ marginTop: 6 }}>Trích nguồn</p>
                    <p className="meta">đúng trang tài liệu</p>
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <BellRing className="mx-auto size-4" style={{ color: "var(--c-sky)" }} />
                    <p className="num font-semibold" style={{ marginTop: 6 }}>1 · 3 · 7 ngày</p>
                    <p className="meta">lịch nhắc ôn lại</p>
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <Check className="mx-auto size-4" style={{ color: "var(--accent)" }} />
                    <p className="num font-semibold" style={{ marginTop: 6 }}>Chấm ngay</p>
                    <p className="meta">kèm giải thích</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="features" className="landing-section" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
          <div className="landing-wrap">
            <div className="sec-head">
              <h2>Học như thế nào</h2>
              <p className="sec-sub">Ba bước, mỗi bước vài phút. Không cần chuẩn bị gì ngoài tài liệu của bạn.</p>
            </div>
            <div className="steps">
              {steps.map((s) => (
                <article key={s.num} className="step">
                  <span className="step-num">{s.num}</span>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Feature blocks */}
        <section className="landing-section" style={{ paddingTop: 72 }}>
          <div className="landing-wrap">
            <div className="space-y-20">
              {features.map(({ icon: Icon, title, desc, flip }) => (
                <div key={title} className={`feature ${flip ? "flip" : ""}`}>
                  <div className="feature-text">
                    <h2>{title}</h2>
                    <p>{desc}</p>
                    <Link href="/register" className="btn btn-accent">Bắt đầu học miễn phí</Link>
                  </div>
                  <div className="feature-visual">
                    <div className="visual-card">
                      {title.startsWith("Hỏi đúng") ? (
                        <>
                          <p className="label">Hỏi đáp trên tài liệu</p>
                          <p className="mt-3 text-sm font-semibold">Pha sáng và pha tối khác nhau thế nào?</p>
                          <p className="meta" style={{ marginTop: 8 }}>
                            Pha sáng cần ánh sáng, diễn ra ở màng tilacôit, tạo ATP và NADPH. Pha tối ở chất nền lục lạp, dùng ATP/NADPH để tổng hợp chất hữu cơ.
                          </p>
                          <p className="meta" style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                            <strong className="text-foreground">Nguồn:</strong> Sinh học 12, Chương 2, trang 44 và 46.
                          </p>
                        </>
                      ) : title.startsWith("Nhắc ôn lại") ? (
                        <div className="space-y-2">
                          <p className="label">Câu đến hạn ôn hôm nay</p>
                          <div className="mini-row"><span className="grow flex items-center gap-2"><BellRing className="size-4" style={{ color: "var(--c-sky)" }} /> 4 câu cần ôn</span><span className="pill pill-green">Sẵn sàng</span></div>
                          <div className="mini-row"><span className="grow">Pha sáng và pha tối khác nhau thế nào?</span><span className="num text-sm font-semibold">+1 ngày</span></div>
                          <div className="mini-row"><span className="grow">Quang hợp diễn ra chủ yếu ở bộ phận nào?</span><span className="num text-sm font-semibold">+3 ngày</span></div>
                        </div>
                      ) : title.startsWith("Chấm tự luận") ? (
                        <>
                          <p className="label">Kết quả chấm theo barem</p>
                          <p className="essay-total" style={{ marginTop: 12 }}>
                            <b>6,5</b><span>/ 8 điểm</span>
                          </p>
                          <div className="prop-list">
                            <div className="mini-row"><span className="grow">Nêu đúng khái niệm</span><span className="num text-sm font-semibold">2 / 2</span></div>
                            <div className="mini-row"><span className="grow">Phân tích vai trò</span><span className="num text-sm font-semibold">2,5 / 3</span></div>
                            <div className="mini-row"><span className="grow">Lấy ví dụ thực tế</span><span className="num text-sm font-semibold">1 / 2</span></div>
                            <div className="mini-row"><span className="grow">Trình bày rõ ràng</span><span className="num text-sm font-semibold">1 / 1</span></div>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="label">Câu hỏi mẫu</p>
                          <p className="mt-3 text-sm font-semibold">Quang hợp diễn ra chủ yếu ở bộ phận nào của cây?</p>
                          <div style={{ marginTop: 16 }}>
                            {["Rễ cây", "Lá cây", "Thân cây", "Hoa"].map((opt, idx) => (
                              <div
                                key={opt}
                                className="option"
                                style={{ marginBottom: 10, cursor: "default" }}
                                aria-disabled
                              >
                                <span className="key">{String.fromCharCode(65 + idx)}</span>
                                <span className="grow">{opt}</span>
                                {idx === 1 ? (
                                  <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-strong)" }}>
                                    <Check className="size-4" />
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                          <p className="meta" style={{ marginTop: 12 }}>
                            <Users className="mr-1 inline size-3.5" /> Câu sai được nhắc ôn lại sau 1 ngày.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="landing-section" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
          <div className="landing-wrap">
            <div className="sec-head center">
              <h2>Học miễn phí, nâng cấp khi cần</h2>
              <p className="sec-sub">Bắt đầu miễn phí. Chỉ trả tiền khi bạn học nghiêm túc và cần chấm bài mỗi ngày.</p>
            </div>
            <div className="pricing">
              {pricing.map((plan) => (
                <div key={plan.name} className={`price-card ${plan.featured ? "featured" : ""}`}>
                  {plan.featured && (
                    <span className="pill pill-green" style={{ position: "absolute", top: -12, left: 24 }}>
                      Phổ biến nhất
                    </span>
                  )}
                  <h3>{plan.name}</h3>
                  <p className="price">
                    {plan.price}
                    {plan.period ? <small> {plan.period}</small> : null}
                  </p>
                  <p className="price-note">{plan.note}</p>
                  <ul>
                    {plan.perks.map((perk) => (
                      <li key={perk}>{perk}</li>
                    ))}
                  </ul>
                  <Link href="/register" className={`btn ${plan.featured ? "btn-accent" : "btn-outline"}`}>
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta-band">
          <h2>Bắt đầu hôm nay — miễn phí</h2>
          <p>Đẩy tài liệu đầu tiên và làm câu hỏi quiz đầu tiên trong 5 phút.</p>
          <Link href="/register" className="btn btn-accent">Tạo tài khoản</Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="foot-inner">
          <span className="meta">TuHoc · Học từ tài liệu của bạn</span>
          <nav aria-label="Chuyển nhanh">
            <Link href="/" className="btn btn-ghost btn-sm">Vào không gian học tập</Link>
            <Link href="/login" className="btn btn-ghost btn-sm">Đăng nhập</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
