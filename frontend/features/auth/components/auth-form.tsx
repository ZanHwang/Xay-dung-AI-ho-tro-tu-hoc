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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    if (registering) {
      if (name.trim().length < 2) { setError("Họ tên cần ít nhất 2 ký tự."); return; }
      if (password.length < 8) { setError("Mật khẩu cần ít nhất 8 ký tự."); return; }
      if (password !== confirm) { setError("Mật khẩu nhập lại chưa khớp."); return; }
    }
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
    <main className="auth-page">
      <div className="auth-shell">
        <Link href="/" className="back-link">
          <ArrowLeft className="size-4" /> Trang giới thiệu
        </Link>
        <div className="auth-wrap">
          <aside className="auth-cover cover-emerald">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <BookOpen className="size-4" />
              </span>
              <span>TuHoc</span>
            </div>
            <div className="nhan-vo">
              <h1 className="name">
                {registering ? "Bắt đầu hành trình học của bạn." : "Chào mừng bạn trở lại."}
              </h1>
            </div>
            <ul>
              {["Sắp xếp tài liệu theo môn", "Lưu và tiếp tục cuộc hội thoại", "Luyện quiz và xem lại kiến thức"].map((text) => (
                <li key={text}>
                  <Check className="size-4" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </aside>

          <section className="panel auth-card">
            {completed ? (
              <div className="py-8 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                  <Check />
                </span>
                <h2 className="mt-5">Đăng ký thành công!</h2>
                <p className="sub mt-3">
                  Tài khoản đã được tạo với email <strong className="break-all text-foreground">{email}</strong>. Hãy đăng nhập để bắt đầu.
                </p>
                <Link href="/login" className="btn btn-accent btn-block mt-6">
                  Đến trang đăng nhập
                </Link>
              </div>
            ) : (
              <>
                <h2>{registering ? "Đăng ký" : "Đăng nhập"}</h2>
                <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
                  {registering && (
                    <>
                      <div>
                        <p className="lbl mb-1.5">Bạn là</p>
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
                      <label className="lbl">
                        Họ và tên
                        <Input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className="input" placeholder="Tên của bạn" />
                      </label>
                    </>
                  )}
                  <label className="lbl">
                    Email
                    <Input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="input" placeholder="ban@example.com" />
                  </label>
                  <div>
                    <label className="lbl" htmlFor="auth-password">Mật khẩu</label>
                    <span className="pw">
                      <Input id="auth-password" type={visible ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 8 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="input" placeholder={registering ? "Ít nhất 8 ký tự" : undefined} />
                      <button type="button" aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
                        {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                      </button>
                    </span>
                  </div>
                  {registering && (
                    <label className="lbl">
                      Nhập lại mật khẩu
                      <Input type={visible ? "text" : "password"} autoComplete="off" required maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy} className="input" />
                    </label>
                  )}
                  {error ? (
                    <div role="alert" className="error-box">
                      <p>{error}</p>
                    </div>
                  ) : null}
                  <Button type="submit" size="lg" disabled={busy} className="w-full">
                    {busy ? "Đang xử lý..." : registering ? "Tạo tài khoản" : "Đăng nhập"}
                    <ArrowRight />
                  </Button>
                </form>
                <p className="auth-switch">
                  {registering ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
                  <Link href={registering ? "/login" : "/register"}>
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
