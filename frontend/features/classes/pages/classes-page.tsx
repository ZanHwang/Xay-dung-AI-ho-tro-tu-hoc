"use client";

import { useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/features/auth/services/auth-api";
import { subjectAccent } from "@/features/subjects/types";
import {
  classesApi,
  type ClassRoom,
  type PendingEssay,
} from "../services/classes-api";
import { ClassAssignments } from "../components/class-assignments";

/** A class has no picked color: derive a stable notebook cover from its id
 * (the same rule as a subject nobody picked a cover for). */
function coverOf(room: ClassRoom) {
  return `cover-${subjectAccent("#6366f1", room.id)}`;
}

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
    <div className="page class-page">
      <div className="view-head">
        <h1>{isTeacher ? "Lớp của tôi" : "Lớp học"}</h1>
        <p>
          {isTeacher
            ? "Tạo lớp, gửi mã cho học sinh, giao đề rồi chấm và chốt điểm."
            : "Vào lớp bằng mã để xem đề thi, nộp bài và theo dõi điểm."}
        </p>
      </div>

      {message ? (
        <div role="alert" className="banner">{message}</div>
      ) : null}

      <div className="class-layout">
        <div className="panel-stack">
          {rooms.length === 0 ? (
            <div className="empty">
              <Users className="mb-2 size-7" aria-hidden="true" />
              <h3>Chưa có lớp nào</h3>
              <p className="!mb-0">{isTeacher ? "Tạo lớp mới ở khung bên dưới để mời học sinh vào bằng mã lớp." : "Nhập mã lớp 6 ký tự giáo viên gửi để vào lớp."}</p>
            </div>
          ) : (
            <ul className="class-list scroll-list" aria-label="Lớp của bạn">
              {rooms.map((room) => (
                <li key={room.id}>
                  <button
                    type="button"
                    className={`class-row ${coverOf(room)}`}
                    aria-current={selected?.id === room.id}
                    onClick={() => selectRoom(room)}
                  >
                    <span className="spine-dot" aria-hidden="true" />
                    <span className="grow">
                      <span className="name">{room.name}</span>
                      <span className="sub2">{room.students} học sinh</span>
                    </span>
                    <span className="class-code">{room.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="panel" onSubmit={(event) => { event.preventDefault(); void join(); }}>
            <label className="lbl" htmlFor="join-code">Vào lớp bằng mã</label>
            <div className="join-row">
              <input
                id="join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Mã lớp (6 ký tự)"
                aria-label="Mã lớp"
                className="input uppercase placeholder:normal-case"
              />
              <Button type="submit" variant="outline">Vào lớp</Button>
            </div>
          </form>

          {isTeacher ? (
            <form className="panel" onSubmit={(event) => { event.preventDefault(); void create(); }}>
              <label className="lbl" htmlFor="new-class">Tạo lớp mới</label>
              <div className="join-row">
                <input
                  id="new-class"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Tên lớp mới"
                  aria-label="Tên lớp mới"
                  className="input"
                />
                <Button type="submit"><Plus /> Tạo lớp</Button>
              </div>
            </form>
          ) : null}
        </div>

        {selected ? (
          <div className="panel-stack">
            <header className={`class-cover ${coverOf(selected)}`}>
              <div className="nhan-vo">
                <h2 className="name">{selected.name}</h2>
                <p>{selected.students} học sinh</p>
              </div>
              <p className="code-card">
                <span>Mã lớp</span>
                <b>{selected.code}</b>
              </p>
            </header>
            <ClassAssignments
              key={`assignments-${selected.id}`} classId={selected.id}
              asTeacher={isTeacher && selected.teacher_id === profile.id} canSubmit={profile.role === "student"}
            />
            {isTeacher && selected.teacher_id === profile.id ? <PendingEssays key={`pending-${selected.id}`} classId={selected.id} /> : null}
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
    <details className="exam-paper">
      <summary>Bài tự luận cũ chờ chấm ({pending.length})</summary>
      <ul className="work-list mt-3">
        {pending.map((essay) => (
          <li key={essay.id} className="answer-key">
            <p className="title">{essay.student}</p><p className="sub2">{essay.essay}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
