"""Essay (bài tự luận) grading by rubric (barem), ported from tu-hoc-rag-v2.

- `parse_rubric`: accept a list [{criterion, max}] or a multi-line string
  like "Ý 1 - 2đ\\nÝ 2 - 3đ".
- `grade`: ask the LLM to score strictly against the barem; when the LLM
  cannot produce valid JSON, fall back to 60% of each criterion's max
  ("Chấm tạm 60%") so the flow never dead-ends.
- Batch variant grades every pending essay in a class (teacher).
"""
import json
import re
from typing import Any, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models import Essay, Subject, User

def parse_rubric(rubric: Any) -> List[dict]:
    """Accept list [{criterion, max}] or a string with one 'Ý - Nđ' per line."""
    if isinstance(rubric, list):
        out = []
        for x in rubric:
            if isinstance(x, dict):
                out.append({"criterion": str(x.get("criterion", "")),
                            "max": float(x.get("max", 1))})
            else:
                out.append({"criterion": str(x), "max": 1.0})
        return out or [{"criterion": "Nội dung", "max": 10.0}]
    if isinstance(rubric, str):
        items = []
        for line in rubric.splitlines():
            m = re.match(r"\s*(.+?)\s*[-:]\s*(\d+(?:[.,]\d+)?)\s*đ?", line.strip())
            if m:
                items.append({"criterion": m.group(1),
                              "max": float(m.group(2).replace(",", "."))})
        return items or [{"criterion": rubric.strip() or "Nội dung", "max": 10.0}]
    return [{"criterion": "Nội dung", "max": 10.0}]


def _fallback_scores(rubric: List[dict]) -> Tuple[List[dict], float, str, str]:
    """60% of each criterion (v2 'Chấm tạm 60%' behaviour)."""
    scores = []
    for r in rubric:
        scores.append({
            "criterion": r["criterion"],
            "score": round(r["max"] * 0.6, 1),
            "max": r["max"],
            "quote": "",
            "feedback": "Chấm tạm (chưa chấm được bằng AI). Thử lại để chấm thật theo barem.",
        })
    total = sum(s["score"] for s in scores)
    return scores, total, "Chấm tạm 60% — cần cấu hình LLM để chấm thật.", "fallback"


class EssayService:
    def __init__(self, db: Session):
        self.db = db

    # -- grading core -------------------------------------------------------

    async def _grade_one(self, prompt: str, rubric: List[dict], essay_text: str):
        """Return (scores, total, overall, mode) — shared by single + batch."""
        from app.ai.llm import llm_manager
        parsed = await llm_manager.grade_essay(prompt, json.dumps(rubric, ensure_ascii=False), essay_text)
        if (
            isinstance(parsed, dict)
            and isinstance(parsed.get("scores"), list)
            and parsed["scores"]
        ):
            scores = []
            for s, r in zip(parsed["scores"], rubric):
                raw_score = s.get("score", 0)
                try:
                    score_val = float(raw_score)
                except (TypeError, ValueError):
                    score_val = 0.0
                scores.append({
                    "criterion": str(s.get("criterion", r["criterion"])),
                    "score": min(score_val, r["max"]),
                    "max": r["max"],
                    "quote": (str(s.get("quote") or ""))[:300],
                    "feedback": str(s.get("feedback") or ""),
                })
            total = sum(s["score"] for s in scores)
            return scores, total, str(parsed.get("overall", "")).strip(), "llm"
        return _fallback_scores(rubric)

    # -- single-essay grade + store ----------------------------------------

    async def grade_essay(
        self,
        user_id: UUID,
        subject_id: Optional[UUID],
        class_id: Optional[UUID],
        prompt: str,
        rubric: Any,
        essay_text: str,
    ) -> dict:
        if not (essay_text or "").strip():
            raise HTTPException(status_code=400, detail="Bài làm trống")
        if not (prompt or "").strip():
            raise HTTPException(status_code=400, detail="Thiếu đề bài")

        if subject_id is not None:
            subject = self.db.query(Subject).filter(
                Subject.id == subject_id, Subject.user_id == user_id).first()
            if not subject:
                raise HTTPException(status_code=404, detail="Không tìm thấy môn học")

        parsed_rubric = parse_rubric(rubric)
        max_total = sum(r["max"] for r in parsed_rubric)
        scores, total, overall, mode = await self._grade_one(prompt, parsed_rubric, essay_text)

        essay = Essay(
            subject_id=subject_id,
            user_id=user_id,
            class_id=class_id,
            prompt=prompt,
            rubric=json.dumps(parsed_rubric, ensure_ascii=False),
            essay=essay_text,
            total=total,
            max_total=max_total,
            feedback=json.dumps(
                {"scores": scores, "overall": overall}, ensure_ascii=False),
            status="graded",
        )
        self.db.add(essay)
        self.db.commit()
        self.db.refresh(essay)

        return {
            "essay_id": essay.id,
            "scores": scores,
            "total": total,
            "max_total": max_total,
            "overall": overall,
            "mode": mode,
        }

    # -- batch grading (teacher) ------------------------------------------

    async def grade_batch(
        self,
        teacher_id: UUID,
        class_id: UUID,
        prompt: str,
        rubric: Any,
    ) -> dict:
        from app.models import ClassRoom, Enrollment
        room = (
            self.db.query(ClassRoom)
            .filter(ClassRoom.id == class_id, ClassRoom.teacher_id == teacher_id)
            .first()
        )
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy lớp hoặc không phải lớp của bạn")

        parsed_rubric = parse_rubric(rubric)
        max_total = sum(r["max"] for r in parsed_rubric)

        # The class's students (teacher auto-enrolls themselves; grade everyone
        # enrolled who has a pending essay).
        pending = (
            self.db.query(Essay)
            .join(Enrollment, Enrollment.user_id == Essay.user_id)
            .filter(
                Enrollment.class_id == class_id,
                Essay.status == "pending",
            )
            .all()
        )
        if not pending:
            return {"graded": 0, "total": 0, "average": 0}

        graded = 0
        running = 0.0
        for e in pending:
            scores, total, overall, _mode = await self._grade_one(prompt, parsed_rubric, e.essay)
            e.total = total
            e.max_total = max_total
            e.feedback = json.dumps(
                {"scores": scores, "overall": overall}, ensure_ascii=False)
            e.status = "graded"
            graded += 1
            running += total
        self.db.commit()
        return {
            "graded": graded,
            "total": len(pending),
            "average": round(running / graded, 2) if graded else 0,
        }

    # -- list -------------------------------------------------------------

    def pending_for_class(self, class_id: UUID) -> List[dict]:
        """The class's pending essays, tagged with the student's name (teacher view)."""
        from app.models import ClassRoom, Enrollment
        room = self.db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy lớp")
        rows = (
            self.db.query(Essay, User)
            .join(Enrollment, Enrollment.user_id == Essay.user_id)
            .join(User, User.id == Essay.user_id)
            .filter(Enrollment.class_id == class_id, Essay.status == "pending")
            .order_by(Essay.created_at.asc())
            .all()
        )
        return [
            {
                "id": e.id,
                "student": u.full_name,
                "prompt": e.prompt,
                "essay": e.essay,
                "status": e.status,
                "created_at": e.created_at,
            }
            for e, u in rows
        ]

    def list_for_user(self, user_id: UUID, class_id: Optional[UUID] = None) -> List[dict]:
        q = self.db.query(Essay).filter(Essay.user_id == user_id)
        if class_id:
            q = q.filter(Essay.class_id == class_id)
        rows = q.order_by(Essay.created_at.desc()).all()
        return [self._out(e) for e in rows]

    def _out(self, e: Essay) -> dict:
        def _loads(s):
            try:
                return json.loads(s) if s else None
            except (TypeError, ValueError):
                return s
        return {
            "id": e.id,
            "subject_id": e.subject_id,
            "class_id": e.class_id,
            "prompt": e.prompt,
            "rubric": _loads(e.rubric),
            "essay": e.essay,
            "total": e.total,
            "max_total": e.max_total,
            "feedback": _loads(e.feedback),
            "status": e.status,
            "created_at": e.created_at,
        }
