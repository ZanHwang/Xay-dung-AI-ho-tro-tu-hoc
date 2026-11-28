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

// The notebook cover: nav items are index tabs, the open one is a sheet of
// paper joined to the page. On mobile the parent layout turns the column into a
// top strip, so the nav renders as a horizontal strip <md and a list at md+.
export function AppSidebar({ user, onLogout, activePage, onNavigate }: Props) {
  return (
    <aside className="board flex shrink-0 flex-col md:h-full md:w-60">
      <div className="flex items-center justify-between gap-3 py-3 pl-5 pr-3 md:block md:py-5">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen className="size-4" />
          </span>
          <span>TuHoc</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <p className="truncate text-sm">{user.name}</p>
          <button type="button" onClick={onLogout} className="nav-item" style={{ width: "auto" }} aria-label="Đăng xuất">
            <LogOut className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 hidden truncate md:block">{user.name}</p>
      </div>

      <nav className="overflow-x-auto px-3 md:flex-1 md:overflow-y-auto md:pr-0">
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

      <div className="hidden px-3 pb-3 md:block">
        <button type="button" onClick={onLogout} className="nav-item">
          <span className="ic" aria-hidden="true">
            <LogOut className="size-5" />
          </span>
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
