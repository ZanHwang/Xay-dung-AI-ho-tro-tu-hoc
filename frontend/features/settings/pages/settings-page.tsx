"use client";

import { initials } from "@/components/layout/app-sidebar";
import type { UserProfile } from "@/features/auth/services/auth-api";

const ROLE_LABEL: Record<string, string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
};

export function SettingsPage({ profile }: { profile: UserProfile }) {
  return (
    <div className="page profile-page">
      <div className="view-head">
        <h1>Hồ sơ</h1>
        <p>Thông tin tài khoản của bạn.</p>
      </div>

      <section className="class-cover cover-emerald">
        <span className="avatar-dot big" aria-hidden="true">{initials(profile.name)}</span>
        <div className="nhan-vo">
          <h2 className="name">{profile.name}</h2>
        </div>
      </section>

      <dl className="profile-list">
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        {profile.role ? (
          <div>
            <dt>Vai trò</dt>
            <dd>{ROLE_LABEL[profile.role] ?? profile.role}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
