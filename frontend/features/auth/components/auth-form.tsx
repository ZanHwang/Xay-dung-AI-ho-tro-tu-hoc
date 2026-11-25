"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi, authErrorMessage } from "../services/auth-api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [major, setMajor] = useState("");
  const [goal, setGoal] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const inFlight = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    if (registering && step === 1) {
      if (name.trim().length < 2) { setError("Họ tên cần ít nhất 2 ký tự."); return; }
      if (password.length < 8) { setError("Mật khẩu cần ít nhất 8 ký tự."); return; }
      if (password !== confirm) { setError("Mật khẩu nhập lại chưa khớp."); return; }
      setStep(2); return;
    }
    if (registering && step === 2) { setStep(3); return; }
    inFlight.current = true; setBusy(true);
    try {
      if (registering) {
        await authApi.register({
          email,
          full_name: name.trim(),
          password,
          confirm_password: confirm,
          role,
        });
        setPassword(""); setConfirm(""); setCompleted(true);
      } else {
        await authApi.login(email, password);
        setPassword(""); router.replace("/workspace");
      }
    } catch (error) { setError(authErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Trang giới thiệu
        </Link>
        <div className="auth-wrap mt-6">
          <aside className="py-3 lg:py-4">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <BookOpen className="size-4" />
              </span>
              <span>TuHoc</span>
            </div>
            <h1 className="mt-7 text-4xl font-bold leading-tight">
              {registering ? "Bắt đầu hành trình học của bạn." : "Chào mừng bạn trở lại."}
            </h1>
            <p className="lede">
              Môn học, tài liệu, cuộc hội thoại và kết quả luyện tập — cùng trong một không gian.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-foreground" style={{ listStyle: "none", margin: "32px 0 0", padding: 0 }}>
              {["Sắp xếp tài liệu theo môn", "Lưu và tiếp tục cuộc hội thoại", "Luyện Quiz và xem lại kiến thức yếu"].map((text) => (
                <li key={text} className="flex items-center gap-3">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full" style={{ background: "var(--accent-soft)" }}>
                    <Check className="size-3" style={{ color: "var(--accent-strong)" }} />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </aside>

          <section className="card auth-card">
            {completed ? (
              <div className="py-8 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                  <Check />
                </span>
                <h2 className="mt-5 text-2xl font-bold">Đăng ký thành công!</h2>
                <p className="sub mt-3">
                  Tài khoản đã được tạo với email <strong className="break-all text-foreground">{email}</strong>. Hãy đăng nhập để bắt đầu.
                </p>
                <Link href="/login" className="btn btn-accent btn-block mt-6">
                  Đến trang đăng nhập
                </Link>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold">{registering ? "Đăng ký" : "Đăng nhập"}</h2>
                {registering && (
                  <ol aria-label="Các bước đăng ký" className="my-6 flex gap-2 text-xs">
                    {["Tài khoản", "Hồ sơ học tập", "Xác nhận"].map((label, index) => (
                      <li
                        key={label}
                        aria-current={step === index + 1 ? "step" : undefined}
                        className={`flex-1 border-t-2 pt-3 ${step >= index + 1 ? "" : "text-muted-foreground"}`}
                        style={{ borderColor: step >= index + 1 ? "var(--accent)" : "var(--border)", color: step >= index + 1 ? "var(--accent-strong)" : undefined }}
                      >
                        {index + 1}. {label}
                      </li>
                    ))}
                  </ol>
                )}
                <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
                  {(!registering || step === 1) && (
                    <>
                      {registering && (
                        <>
                          <div>
                            <p className="label mb-2">Bạn là</p>
                            <div className="role-pick" role="group" aria-label="Chọn vai trò">
                              <button
                                type="button"
                                onClick={() => setRole("student")}
                                aria-pressed={role === "student"}
                              >
                                <b>Học sinh</b>
                                <span>Tự học, ôn thi</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setRole("teacher")}
                                aria-pressed={role === "teacher"}
                              >
                                <b>Giáo viên</b>
                                <span>Tạo lớp, chấm bài</span>
                              </button>
                            </div>
                          </div>
                          <label className="field">
                            Họ và tên
                            <Input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className="input" placeholder="Tên của bạn" />
                          </label>
                        </>
                      )}
                      <label className="field">
                        Email
                        <Input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="input" placeholder="ban@example.com" />
                      </label>
                      <label className="field">
                        Mật khẩu
                        <span className="relative block">
                          <Input type={visible ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 8 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="input pr-12" placeholder="Ít nhất 8 ký tự" />
                          <button type="button" aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible} onClick={() => setVisible((current) => !current)} className="absolute right-3 top-2.5 text-muted-foreground">
                            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </span>
                      </label>
                      {registering && (
                        <label className="field">
                          Nhập lại mật khẩu
                          <Input type={visible ? "text" : "password"} autoComplete="off" required maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy} className="input" />
                        </label>
                      )}
                    </>
                  )}
                  {registering && step === 2 && (
                    <>
                      <p className="sub">Thông tin này giúp chúng tôi cá nhân hóa trải nghiệm học tập. Bạn có thể bỏ trống.</p>
                      <label className="field">
                        Chuyên ngành / Lĩnh vực học
                        <Input maxLength={120} value={major} onChange={(event) => setMajor(event.target.value)} className="input" placeholder="Ví dụ: Khoa học dữ liệu" />
                      </label>
                      <label className="field">
                        Mục tiêu học tập
                        <textarea maxLength={300} value={goal} onChange={(event) => setGoal(event.target.value)} className="input mt-0 min-h-28" placeholder="Bạn muốn cải thiện điều gì?" />
                      </label>
                    </>
                  )}
                  {registering && step === 3 && (
                    <dl className="card space-y-4" style={{ background: "var(--surface-2)", padding: 16 }}>
                      {[["Họ tên", name], ["Email", email]].map(([label, value]) => (
                        <div key={label}>
                          <dt className="label">{label}</dt>
                          <dd className="mt-1 break-words text-foreground">{value}</dd>
                        </div>
                      ))}
                      {major && (
                        <div>
                          <dt className="label">Chuyên ngành</dt>
                          <dd className="mt-1 break-words text-foreground">{major}</dd>
                        </div>
                      )}
                      {goal && (
                        <div>
                          <dt className="label">Mục tiêu</dt>
                          <dd className="mt-1 break-words text-foreground">{goal}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {error ? (
                    <div role="alert" className="error-box">
                      <p>{error}</p>
                    </div>
                  ) : null}
                  <div className="flex gap-3">
                    {registering && step > 1 && (
                      <Button type="button" variant="outline" disabled={busy} onClick={() => { setStep(step - 1); setError(""); }}>
                        Quay lại
                      </Button>
                    )}
                    <Button type="submit" disabled={busy} className="flex-1">
                      {busy ? "Đang xử lý..." : registering ? (step < 3 ? "Tiếp tục" : "Hoàn tất đăng ký") : "Đăng nhập"}
                      <ArrowRight />
                    </Button>
                  </div>
                </form>
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  {registering ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
                  <Link href={registering ? "/login" : "/register"} className="font-medium underline">
                    {registering ? "Đăng nhập" : "Đăng ký"}
                  </Link>
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
