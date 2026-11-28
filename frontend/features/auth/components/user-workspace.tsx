"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { LearningWorkspace } from "@/features/workspace/components/learning-workspace";
import { authApi, authErrorMessage, type UserProfile } from "../services/auth-api";
import { reviewStore } from "@/features/reviews/services/review-store";
import { dashboardStore } from "@/features/dashboard/services/dashboard-store";

export function UserWorkspace() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;

    authApi.current()
      .then((profile) => {
        if (disposed) return;
        if (!profile) {
          router.replace("/login");
        } else {
          setUser(profile);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setError(authErrorMessage(err));
          setLoading(false);
        }
      });

    return () => { disposed = true; };
  }, [router]);

  async function logout() {
    try {
      await authApi.logout();
      // logout() is a client-side route change (router.replace), not a full
      // page reload - these module-level caches would otherwise survive
      // into the next account's session and briefly show the previous
      // account's numbers (due reviews, dashboard stats) until something
      // happens to call refresh().
      reviewStore.reset();
      dashboardStore.reset();
      router.replace("/");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  if (loading) {
    return (
      <main className="boot">
        <span className="brand-mark" aria-hidden="true"><BookOpen className="size-4" /></span>
        <p role="status">Đang mở không gian học tập...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="boot">
        <p role={error ? "alert" : "status"} className="err">
          {error || "Không thể xác thực người dùng."}
        </p>
        <Link href="/login" className="btn btn-outline">
          Về trang đăng nhập
        </Link>
      </main>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className="error-box" style={{ margin: 0, textAlign: "center" }}>
          {error}
        </p>
      ) : null}
      <LearningWorkspace user={user} onLogout={() => void logout()} />
    </>
  );
}
