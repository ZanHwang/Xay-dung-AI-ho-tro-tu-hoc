"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
      <main className="grid min-h-screen place-items-center bg-card p-6 text-center">
        <div>
          <p role="status" className="text-sm text-muted-foreground">
            Đang mở không gian học tập...
          </p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-card p-6 text-center">
        <div>
          <p role={error ? "alert" : "status"} className="err text-sm">
            {error || "Không thể xác thực người dùng."}
          </p>
          <Link href="/login" className="mt-4 inline-block" style={{ color: "var(--accent-strong)", textDecoration: "underline" }}>
            Về trang đăng nhập
          </Link>
        </div>
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
