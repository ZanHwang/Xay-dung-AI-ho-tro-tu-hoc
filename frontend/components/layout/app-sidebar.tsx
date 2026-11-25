"use client";

import { BookOpen, LogOut } from "lucide-react";
import { navigationItems } from "@/config/navigation";
import type { UserProfile } from "@/features/auth/services/auth-api";
import type { NavKey } from "@/features/workspace/types";

type Props = {
  user: UserProfile;
  onLogout: () => void;
  activePage: NavKey;
  onNavigate: (page: NavKey) => void;
};

// v2 shell: cream sidebar, Lexend brand mark, .nav-item rows. On mobile the
// parent layout turns the column into a top strip, so the nav renders as a
// horizontal strip <md and a vertical list at md+.
export function AppSidebar({ user, onLogout, activePage, onNavigate }: Props) {
  return (
    <aside className="flex shrink-0 flex-col border-b border-border bg-background md:h-full md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 px-5 py-4 md:block">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen className="size-4" />
          </span>
          <span>TuHoc</span>
        </div>
        <p className="meta truncate md:mt-2">{user.name}</p>
      </div>

      <nav className="overflow-x-auto px-3 pb-3 md:flex-1 md:overflow-y-auto">
        <p className="nav-section hidden md:block">Học tập</p>
        <ul className="flex gap-1 md:flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {navigationItems.map((item) => (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={activePage === item.id ? "page" : undefined}
                className={`nav-item ${activePage === item.id ? "active" : ""}`}
              >
                <span className="ic" aria-hidden="true">
                  <item.icon className="size-5" />
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="px-3 pb-3 md:mt-auto md:border-t md:pt-3">
        <button type="button" onClick={onLogout} className="nav-item" style={{ width: "100%", marginTop: 4 }}>
          <span className="ic" aria-hidden="true">
            <LogOut className="size-5" />
          </span>
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
