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

export function ClassesPage({ profile }: { profile: UserProfile }) {
  const isTeacher = profile.role === "teacher";
  const [rooms, setRooms] = useState<ClassRoom[]>([]);
  const [selected, setSelected] = useState<ClassRoom | null>(null);
  const [pending, setPending] = useState<PendingEssay[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");

  function loadList() {
    classesApi
      .list()
      .then((list) => {
        setRooms(list);
        if (!selected && list.length > 0) void selectRoom(list[0]);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Không tải được lớp học."));
  }

  async function selectRoom(room: ClassRoom) {
    setSelected(room);
    setMessage("");
    try {
      const p = await classesApi.pendingEssays(room.id);
      setPending(p.essays);
    } catch {
      setPending([]);
    }
  }

  async function join() {
    if (!joinCode.trim()) return;
    setMessage("");
    try {
      const room = await classesApi.join(joinCode.trim());
      loadList();
      await selectRoom(room);
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
      await selectRoom(room);
      setNewName("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Tạo lớp thất bại.");
    }
  }

  // Load the list once; re-select the room whenever it changes.
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="view-head">
        <div>
          <p className="label" style={{ color: "var(--accent-strong)" }}>Lớp học</p>
          <h2 className="mt-1">{isTeacher ? "Lớp của tôi" : "Lớp học"}</h2>
          <p className="sub">Vào lớp bằng mã và (với giáo viên) chấm hàng loạt bài tự luận theo barem.</p>
        </div>
      </div>

      {message ? (
        <div role="alert" className="banner banner-info" style={{ marginTop: 16 }}>{message}</div>
      ) : null}

      <div style={{ marginTop: 24, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
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
                    onClick={() => void selectRoom(room)}
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

        <div>
          {isTeacher ? (
            <section className="card">
              <h3>Bài tự luận chờ chấm {selected ? `— ${selected.name}` : ""}</h3>
              <p className="meta" style={{ marginTop: 4 }}>
                {pending.length > 0
                  ? `${pending.length} bài đang chờ. Chấm hàng loạt từ màn tự luận khi sẵn sàng.`
                  : "Không có bài nào chờ chấm."}
              </p>
              <div className="scroll-list" style={{ marginTop: 16 }}>
                {pending.map((e) => (
                  <div key={e.id} className="list-row" style={{ background: "var(--surface-2)", border: 0, flexWrap: "wrap" }}>
                    <div className="grow">
                      <p className="title">{e.student}</p>
                      <p className="sub2" style={{ marginTop: 4 }}>{e.essay}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
