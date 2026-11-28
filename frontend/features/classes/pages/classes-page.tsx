"use client";

import { useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/features/auth/services/auth-api";
import {
  classesApi,
  type ClassRoom,
  type PendingEssay,
} from "../services/classes-api";
import { ClassAssignments } from "../components/class-assignments";

export function ClassesPage({ profile }: { profile: UserProfile }) {
  const isTeacher = profile.role === "teacher";
  const [rooms, setRooms] = useState<ClassRoom[]>([]);
  const [selected, setSelected] = useState<ClassRoom | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");

  function loadList() {
    classesApi
      .list()
      .then((list) => {
        setRooms(list);
        setSelected((room) => room ?? list[0] ?? null);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Không tải được lớp học."));
  }

  function selectRoom(room: ClassRoom) {
    setSelected(room);
    setMessage("");
  }

  async function join() {
    if (!joinCode.trim()) return;
    setMessage("");
    try {
      const room = await classesApi.join(joinCode.trim());
      loadList();
      selectRoom(room);
      setJoinCode("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Không tìm thấy mã lớp.");
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setMessage("");
    try {
      const room = await classesApi.create(newName.trim());
      loadList();
      selectRoom(room);
      setNewName("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Tạo lớp thất bại.");
    }
  }

  // Load the list once; re-select the room whenever it changes.
  useEffect(() => {
    loadList();
  }, []);

  return (
    <div>
      <div className="view-head">
        <div>
          <p className="label" style={{ color: "var(--accent-strong)" }}>Lớp học</p>
          <h2 className="mt-1">{isTeacher ? "Lớp của tôi" : "Lớp học"}</h2>
          <p className="sub">Vào lớp bằng mã để xem đề thi, nộp bài và theo dõi điểm.</p>
        </div>
      </div>

      {message ? (
        <div role="alert" className="banner banner-info" style={{ marginTop: 16 }}>{message}</div>
      ) : null}

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(245px,1fr)_minmax(0,1.85fr)]">
        <div>
          <section className="card">
            <h3>Lớp của bạn</h3>
            <div style={{ marginTop: 16 }}>
              {rooms.length === 0 ? (
                <div className="empty">
                  <Users className="mx-auto mb-2 size-7" style={{ color: "var(--muted)" }} />
                  <h3>Chưa có lớp nào</h3>
                  <p>{isTeacher ? "Tạo lớp mới ở khung bên dưới để mời học sinh vào bằng mã lớp." : "Nhập mã lớp 6 ký tự giáo viên gửi để vào lớp."}</p>
                </div>
              ) : null}
              <div className="scroll-list" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => selectRoom(room)}
                    className="list-row"
                    style={{
                      cursor: "pointer",
                      border: selected?.id === room.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: selected?.id === room.id ? "var(--accent-soft)" : "var(--surface-2)",
                      fontFamily: "inherit",
                      color: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span className="grow">
                      <span className="title block">{room.name}</span>
                      <span className="sub2 block">{room.students} học sinh</span>
                    </span>
                    <span className="pill pill-grey" style={{ fontFamily: "monospace" }}>{room.code}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Mã lớp (6 ký tự)"
                aria-label="Mã lớp"
                className="input"
                style={{ flex: 1, textTransform: "uppercase" }}
              />
              <Button variant="outline" onClick={() => void join()}>Vào lớp</Button>
            </div>

            {isTeacher ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Tên lớp mới"
                    aria-label="Tên lớp mới"
                    className="input"
                    style={{ flex: 1 }}
                  />
                  <Button onClick={() => void create()}><Plus /> Tạo lớp</Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {selected ? (
          <div className="min-w-0">
            <ClassAssignments
              key={selected.id} classId={selected.id}
              asTeacher={isTeacher && selected.teacher_id === profile.id} canSubmit={profile.role === "student"}
            />
            {isTeacher && selected.teacher_id === profile.id ? <PendingEssays key={selected.id} classId={selected.id} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PendingEssays({ classId }: { classId: string }) {
  const [pending, setPending] = useState<PendingEssay[]>([]);
  useEffect(() => {
    let current = true;
    classesApi.pendingEssays(classId).then((data) => {
      if (current) setPending(data.essays);
    }).catch(() => {});
    return () => { current = false; };
  }, [classId]);
  if (!pending.length) return null;
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Bài tự luận cũ chờ chấm ({pending.length})</summary>
      <ul className="mt-3 space-y-2">
        {pending.map((essay) => (
          <li key={essay.id} className="rounded-lg bg-muted p-3">
            <p className="title">{essay.student}</p><p className="sub2">{essay.essay}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
