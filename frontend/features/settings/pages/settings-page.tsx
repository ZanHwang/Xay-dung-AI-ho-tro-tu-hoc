"use client";

import { User } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { UserProfile } from "@/features/auth/services/auth-api";

const ROLE_LABEL: Record<string, string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
};

export function SettingsPage({ profile }: { profile: UserProfile }) {
  return (
    <div>
      <div className="view-head">
        <div>
          <p className="label" style={{ color: "var(--accent-strong)" }}>Cá nhân hóa</p>
          <h2 className="mt-1">Cài đặt</h2>
          <p className="sub">Xem hồ sơ học tập của bạn.</p>
        </div>
      </div>

      <section className="card form-card" style={{ marginTop: 24 }}>
        <div className="row-between">
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
              <User />
            </span>
            <div>
              <h3>Hồ sơ học tập</h3>
              <p className="meta">Thông tin tài khoản của bạn.</p>
            </div>
          </div>
          {profile.role ? <span className="pill pill-green">{ROLE_LABEL[profile.role] ?? profile.role}</span> : null}
        </div>
        <div style={{ marginTop: 24, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <label className="field">
            Họ và tên
            <Input value={profile.name} readOnly className="input" />
          </label>
          <label className="field">
            Email
            <Input value={profile.email} readOnly className="input" />
          </label>
          {profile.major ? (
            <label className="field">
              Chuyên ngành / Lĩnh vực học
              <Input value={profile.major} readOnly className="input" />
            </label>
          ) : null}
        </div>
        {profile.goal ? <p className="meta" style={{ marginTop: 16 }}>Mục tiêu học tập: {profile.goal}</p> : null}
      </section>
    </div>
  );
}
