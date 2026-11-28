"use client";

import { BookOpen, ChevronUp, LogOut, User } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { navigationItems } from "@/config/navigation";
import type { UserProfile } from "@/features/auth/services/auth-api";
import { useDueReviews } from "@/features/reviews/hooks/use-due-reviews";
import type { NavKey } from "@/features/workspace/types";

type Props = {
  user: UserProfile;
  onLogout: () => void;
  activePage: NavKey;
  onNavigate: (page: NavKey) => void;
};

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return [words.length > 1 ? words[0] : "", words[words.length - 1] ?? ""]
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

// On mobile the parent layout turns the column into a top strip: brand and name
// button first, then the nav as a horizontal row.
export function AppSidebar({ user, onLogout, activePage, onNavigate }: Props) {
  // The due-review count stays visible on every page, next to "Hôm nay" where
  // the review button is.
  const { total: dueTotal } = useDueReviews();
  // Môn học and Sổ điểm are opened from Hôm nay and have no item of their own.
  const current = activePage === "subjects" || activePage === "grades" ? "dashboard" : activePage;

  const profileMenu = (compact: boolean) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="who" style={compact ? { width: "auto", minHeight: 44, padding: 4 } : undefined} aria-label={`Tài khoản ${user.name}`}>
          <span className="avatar-dot" aria-hidden="true">{initials(user.name)}</span>
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1 truncate">{user.name}</span>
              <ChevronUp className="size-4" aria-hidden="true" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="menu-panel" side={compact ? "bottom" : "top"} align={compact ? "end" : "start"}>
        <DropdownMenuItem onSelect={() => onNavigate("settings")}>
          <User /> Hồ sơ
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut /> Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <aside className="board flex shrink-0 flex-col md:h-full md:w-60">
      <div className="flex items-center justify-between gap-3 py-3 pl-5 pr-3 md:py-5">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen className="size-4" />
          </span>
          <span>TuHoc</span>
        </div>
        <div className="md:hidden">{profileMenu(true)}</div>
      </div>

      <nav aria-label="Điều hướng chính" className="overflow-x-auto px-3 pb-2 md:flex-1 md:overflow-y-auto">
        <ul className="flex gap-1 md:flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {navigationItems.map((item) => (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={current === item.id ? "page" : undefined}
                className={`nav-item ${current === item.id ? "active" : ""}`}
              >
                <item.icon className="size-5" aria-hidden="true" />
                {item.label}
                {item.id === "dashboard" && dueTotal > 0 ? (
                  <span className="nav-badge" title={`${dueTotal} câu cần ôn`}>
                    {dueTotal}
                    <span className="sr-only"> câu cần ôn</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="hidden px-3 pb-3 md:block">{profileMenu(false)}</div>
    </aside>
  );
}
