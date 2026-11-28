import json
from decimal import Decimal
from uuid import UUID, uuid4

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from app.ai.llm import llm_manager
from app.database import Base, get_db
from app.install_exam_schema import install_exam_schema
from app.main import app
from app.models import Essay, User
from app.models.exam import ExamSubmission
from app.schemas.exam import GradingKey
from app.services import exam_grading
from app.services.essay_arithmetic import check_equation
from app.services.exam_uploads import ExamUpload, render_uploads
from app.utils.security import create_access_token


@pytest.fixture
def exam_db(tmp_path, monkeypatch):
    async def unexpected_call(*args, **kwargs):
        raise AssertionError("The exam tests must supply their own vision responses.")

    monkeypatch.setattr(exam_grading, "exam_json", unexpected_call)
    engine = create_engine("sqlite:///" + (tmp_path / "exam.db").as_posix())
    Base.metadata.create_all(engine, tables=[
        table for table in Base.metadata.sorted_tables if not table.info.get("explicit_install")
    ])

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        yield engine, TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def account(engine, name, role="student"):
    with Session(engine) as db:
        user = User(email=f"{uuid4().hex}@example.com", full_name=name, hashed_password="unused", role=role)
        db.add(user)
        db.commit()
        user_id = user.id
    return user_id, {"Authorization": "Bearer " + create_access_token({"sub": str(user_id)})}


def document(kind):
    with fitz.open() as pdf:
        page = pdf.new_page(width=300, height=420)
        page.insert_text((15, 35), "Exam fixture")
        if kind == "pdf":
            return pdf.tobytes()
        return page.get_pixmap().tobytes(kind)


def uploads(include_official=True):
    files = [
        ("exam_files", ("de.pdf", document("pdf"), "application/pdf")),
        ("answer_files", ("bai.png", document("png"), "image/png")),
    ]
    if include_official:
        files.append(("official_files", ("dap-an.jpg", document("jpeg"), "image/jpeg")))
    return files


def model_response(
    *, bad_quote=False, wrong_points=False, unreadable=False, missing_answer=False,
    conflicting_exam=False, conflicting_choice=False, conflicting_mark=False, full_grade=False,
):
    async def fake(prompt, image=None):
        if image:
            assert image.startswith(b"\xff\xd8\xff")
        if prompt.startswith("Đọc đề in"):
            response = {"readable": True, "text": "Câu 1 (2 điểm): A hoặc B\nCâu 2 (8 điểm): Giải x."}
        elif prompt.startswith("Đọc nguyên văn chữ viết tay"):
            response = {"readable": not unreadable, "text": "Câu 1: A\nCâu 2: $x=2$ vì chia cả hai vế",
                        "choices": [{"label": "1", "selected_options": ["B" if conflicting_mark else "A"]},
                                    {"label": "2", "selected_options": []}]}
        elif prompt.startswith("Đọc nguyên văn đáp án"):
            response = {"readable": True, "text": "Câu 1: B"}
        elif prompt.startswith("Xác định cấu trúc"):
            response = {"complete": not conflicting_exam, "total_points": 10, "questions": [
                {"id": "1", "prompt": "Chọn", "max_points": 2, "options": {"A": "Đáp án A", "B": "Đáp án B"}},
                {"id": "2", "prompt": "Giải $2x=4$.", "max_points": 8},
            ]}
        elif prompt.startswith("Ghép bài làm"):
            response = {"complete": True, "answers": [
                {"id": "1", "status": "answered", "selected_options": ["A"], "evidence_lines": [3]},
            ]}
            if not missing_answer:
                response["answers"].append({
                    "id": "2", "status": "answered", "text": "$x=2$ vì chia cả hai vế", "evidence_lines": [2],
                })
        elif prompt.startswith("Đối chiếu đề"):
            response = {"readable": True, "missing": ["2"], "keys": [{
                "id": "1", "correct_options": ["B"], "solution": "Đáp án B theo đề.", "evidence": "Câu 1: B",
            }]}
        elif prompt.startswith("Tự giải"):
            keys = [
                {"id": "2", "solution": "Chia hai vế cho 2: $x=2$.", "correct_options": ["A"],
                 "rubric": [{"label": "Tính x", "max_points": 8}]},
            ]
            if "Đáp án A" in prompt:
                keys.insert(0, {"id": "1", "correct_options": ["A"], "solution": "Chọn A.",
                                "rubric": [{"label": "Chọn đúng", "max_points": 2}]})
            response = {"complete": True, "keys": keys}
        elif prompt.startswith("Kiểm chứng độc lập"):
            response = {"complete": True, "choices": [{"id": "1", "correct_options": ["B" if conflicting_choice else "A"]}]}
        elif prompt.startswith("Giải thích ngắn"):
            response = {"supported": True, "correction": "Đối chiếu dữ kiện với phương án B."}
        elif prompt.startswith("Chấm bài làm"):
            response = {"readable": True, "feedback": "Còn thiếu bước kiểm tra.", "correction": "Thử thế $x=2$ vào đề.", "scores": [
                {"index": 1, "points": 9 if wrong_points else "6.25", "quote": "dữ liệu bịa" if bad_quote else "$x=2$",
                 "feedback": "Thiếu bước thế lại."},
            ]}
            if full_grade:
                response.pop("correction")
                response["scores"][0]["points"] = 8
        else:
            raise AssertionError(prompt[:80])
        return json.dumps(response, ensure_ascii=False)

    return fake


def test_schema_is_explicit(exam_db):
    engine, client = exam_db
    _, auth = account(engine, "Học sinh")
    response = client.get("/api/exams/history", headers=auth)
    assert response.status_code == 503
    assert not inspect(engine).has_table("exam_submissions")
    install_exam_schema(engine)
    install_exam_schema(engine)
    assert client.get("/api/exams/history", headers=auth).json() == []


@pytest.mark.parametrize("include_official, score, source, full_grade", [
    (True, "6.25", "official", False), (False, "8.25", "ai", False), (True, "8", "official", True),
])
def test_personal_mixed_upload_history_and_private_files(exam_db, monkeypatch, include_official, score, source, full_grade):
    engine, client = exam_db
    install_exam_schema(engine)
    _, auth = account(engine, "Học sinh")
    _, outsider = account(engine, "Khác")
    monkeypatch.setattr(exam_grading, "exam_json", model_response(full_grade=full_grade))
    files = uploads(include_official)
    response = client.post("/api/exams/submissions", files=files, headers=auth)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["state"] == "graded"
    assert data["kind"] == "mixed"
    assert Decimal(data["ai_total"]) == Decimal(score)
    assert Decimal(data["max_total"]) == 10
    assert data["analysis"]["grades"][0]["source"] == source
    if include_official:
        assert data["analysis"]["grades"][0]["correction"] == "Đối chiếu dữ kiện với phương án B."
    assert "$x=2$" in data["analysis"]["grades"][1]["correction"]
    assert data["analysis"]["answers"][0]["evidence"] == "Dấu chọn câu 1: A"
    assert len(data["analysis"]["pages"]) == len(files)
    url = f"/api/exams/submissions/{data['id']}"
    assert client.get(url, headers=auth).json() == data
    assert client.get("/api/exams/history", headers=auth).json()[0]["id"] == data["id"]
    assert client.get("/api/exams/history", headers=outsider).json() == []
    assert client.get(url, headers=outsider).status_code == 404
    file_url = url + "/files/" + data["files"][1]["id"]
    assert client.get(file_url, headers=outsider).status_code == 404
    original = client.get(file_url, headers=auth)
    assert original.content == files[1][1][1]
    assert original.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("problem", [
    "unreadable", "bad_quote", "wrong_points", "missing_answer", "conflicting_exam", "conflicting_choice", "conflicting_mark",
])
def test_uncertain_inputs_never_get_a_score(exam_db, monkeypatch, problem):
    engine, client = exam_db
    install_exam_schema(engine)
    _, auth = account(engine, "Học sinh")
    monkeypatch.setattr(exam_grading, "exam_json", model_response(**{problem: True}))
    result = client.post("/api/exams/submissions", files=uploads(problem != "conflicting_choice"), headers=auth)
    assert result.status_code == 201, result.text
    data = result.json()
    assert data["state"] == "needs_review"
    assert data["ai_total"] is None
    assert data["analysis"]["grades"] == []
    assert data["analysis"]["reason"]


def test_partial_readable_choices_are_graded_without_guessing_a_total(exam_db, monkeypatch):
    engine, client = exam_db
    install_exam_schema(engine)
    _, auth = account(engine, "Học sinh")
    data = [
        ("1", "Số có hai chữ số bé hơn 90 và lớn hơn 87 là:", {"A": "88", "B": "90", "C": "89", "D": "91"}, ""),
        ("2", "Kết quả của phép tính 4+65−23 là:", {"A": "86", "B": "46", "C": "42", "D": "82"}, ""),
        ("3", "Bố đi công tác một tuần và hai chức ngày. Hỏi bố đi bao nhiêu ngày?", {"A": "21 ngày", "B": "9 ngày", "C": "27 ngày"},
         "Cụm ‘hai chức’ chưa rõ."),
        ("4", "Mẹ Lan năm nay 42 tuổi, mẹ hơn chị Lan 22 tuổi. Hỏi chị Lan năm nay bao nhiêu tuổi?",
         {"A": "20 tuổi", "B": "64 tuổi", "C": "24 tuổi"}, "Câu có thông tin không đầy đủ để tính tuổi."),
        ("5", "Hình vẽ dưới đây có bao nhiêu tam giác?", {"A": "3", "B": "4", "C": "5", "D": "6"}, "Thiếu dữ kiện hình vẽ."),
        ("6", "Viết số gồm có 9 chục 8 đơn vị.", {}, ""),
        ("7", "Trong các số 89; 98; 79; 87; 97, số lớn nhất là:", {"A": "98", "B": "89", "C": "97", "D": "79"}, ""),
    ]
    questions = [
        {"id": qid, "prompt": prompt, "options": options, "review_reason": issue,
         "excerpt": f"Bài {qid}. {prompt}" + "".join(f"\n{letter}. {text}" for letter, text in options.items())}
        for qid, prompt, options, issue in data
    ]
    mark_values = [("1", "B", "88"), ("2", "B", "86"), ("3", "C", "9 ngày"), ("4", "B", "64 tuổi"),
                   ("5", "C", "5"), ("6", "B", "5 chục 7 đơn vị"), ("7", "B", "89")]
    image_reads = []

    async def model(prompt, image=None):
        if image:
            image_reads.append(image)
        if prompt.startswith("Đọc đề in"):
            response = {"readable": True, "text": "\n\n".join(x["excerpt"] for x in questions)}
        elif prompt.startswith("Đọc nguyên văn chữ viết tay"):
            response = {
                "readable": False,
                "text": "\n".join(f"Bài {qid}. {letter}. {value}" for qid, letter, value in mark_values),
                "choices": [{"label": f"Bài {qid}.", "selected_options": [letter]} for qid, letter, _ in mark_values],
            }
        elif prompt.startswith("Tách các câu"):
            response = {"questions": questions}
        elif prompt.startswith("Giải độc lập"):
            assert "tam giác" not in prompt and "42 tuổi" not in prompt and "số lớn nhất" not in prompt
            response = {"keys": [
                {"id": "1", "correct_options": ["A"], "solution": "88 nằm giữa 87 và 90."},
                {"id": "2", "correct_options": ["B"], "solution": "4 + 65 - 23 = 46."},
            ]}
        else:
            raise AssertionError(prompt[:75])
        return json.dumps(response, ensure_ascii=False)

    monkeypatch.setattr(exam_grading, "exam_json", model)
    response = client.post("/api/exams/submissions", files=uploads(False), headers=auth)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["state"] == "needs_review"
    assert result["ai_total"] is None and result["max_total"] is None
    grades = result["analysis"]["grades"]
    assert [(item["id"], item["correct_options"], Decimal(item["points"])) for item in grades] == [
        ("4", ["A"], Decimal(0)), ("7", ["A"], Decimal(0)),
    ]
    items = {item["id"]: item["reason"] for item in result["analysis"]["review_items"]}
    assert set(items) == {"1", "2", "3", "5", "6"}
    assert "nhiều phương án" in items["1"] and "chưa khớp" in items["2"]
    assert items["5"] == "Thiếu dữ kiện hình vẽ."
    saved = client.get(f"/api/exams/submissions/{result['id']}", headers=auth).json()
    assert saved["analysis"]["review_items"] == result["analysis"]["review_items"]
    with Session(engine) as db:
        legacy = db.get(ExamSubmission, UUID(result["id"]))
        legacy.analysis = json.dumps({"state": "needs_review", "pages": saved["analysis"]["pages"]})
        db.commit()
    retry = client.post(f"/api/exams/submissions/{result['id']}/regrade", json={"revision": 1}, headers=auth)
    assert retry.status_code == 200, retry.text
    assert retry.json()["analysis"]["grades"] == grades
    assert retry.json()["ai_total"] is None and len(image_reads) == 2


def test_retry_chickens_problem_uses_saved_ocr_and_keeps_the_history_entry(exam_db, monkeypatch):
    engine, client = exam_db
    install_exam_schema(engine)
    _, owner = account(engine, "Học sinh")
    _, outsider = account(engine, "Người khác")
    question = "Bài toán: Nhà An có 9 con gà, mẹ đem bán 3 con gà. Hỏi nhà An còn lại mấy con gà?"
    answer = "Bài giải: Số gà còn lại là 9 – 3 = 6 (con). Đáp số: 6 con gà."
    first_pass = {"complete": False, "reason": "Đề thiếu cấu trúc và không có câu trắc nghiệm.", "questions": []}

    async def first_attempt(prompt, image=None):
        if prompt.startswith("Đọc đề in"):
            return json.dumps({"readable": True, "text": question})
        if prompt.startswith("Đọc nguyên văn chữ viết tay"):
            return json.dumps({"readable": True, "text": answer})
        if prompt.startswith("Xác định cấu trúc"):
            return json.dumps(first_pass)
        assert prompt.startswith("Xác minh dữ liệu OCR")
        return json.dumps({"complete": False})

    monkeypatch.setattr(exam_grading, "exam_json", first_attempt)
    response = client.post("/api/exams/submissions", files=uploads(False), headers=owner)
    assert response.status_code == 201
    prior = response.json()
    assert prior["state"] == "needs_review"
    assert prior["ai_total"] is None
    path = f"/api/exams/submissions/{prior['id']}/regrade"

    async def model(prompt, image=None):
        assert image is None, "Readable OCR should be reused."
        if prompt.startswith("Xác định cấu trúc"):
            value = first_pass
        elif prompt.startswith("Xác minh dữ liệu OCR"):
            value = {"complete": True, "printed_points": None}
        elif prompt.startswith("Ghép bài làm"):
            assert question in prompt
            value = {"complete": True, "answers": [{"id": "1", "status": "answered", "text": answer, "evidence_lines": [1]}]}
        elif prompt.startswith("Tự giải"):
            assert answer not in prompt
            value = {"complete": True, "keys": [{"id": "1", "solution": "Còn lại 6 con gà.",
                     "rubric": [{"label": "Lập phép trừ đúng", "max_points": 6},
                                {"label": "Nêu kết quả và đơn vị", "max_points": 4}]}]}
        elif prompt.startswith("Chấm bài làm"):
            value = {"readable": True, "feedback": "Phép tính, kết quả và đơn vị đều đúng.", "scores": [
                {"index": 1, "points": 6, "quote": "$9 - 3 = 6$", "feedback": "Phép trừ đúng."},
                {"index": 2, "points": 4, "quote": "6 con gà", "feedback": "Kết quả và đơn vị đúng."},
            ]}
        else:
            raise AssertionError(prompt[:80])
        return json.dumps(value, ensure_ascii=False)

    monkeypatch.setattr(exam_grading, "exam_json", model)
    assert client.post(path, json={"revision": 1}, headers=outsider).status_code == 404
    assert client.post(path, json={"revision": 2}, headers=owner).status_code == 409
    retry = client.post(path, json={"revision": 1}, headers=owner)
    assert retry.status_code == 200, retry.text
    data = retry.json()
    assert data["id"] == prior["id"] and data["revision"] == 2
    assert data["files"] == prior["files"]
    assert data["state"] == "graded" and data["kind"] == "written"
    assert Decimal(data["ai_total"]) == Decimal(data["max_total"]) == 10
    assert data["analysis"]["questions"][0]["prompt"] == question
    assert len(client.get("/api/exams/history", headers=owner).json()) == 1
    assert client.post(path, json={"revision": 2}, headers=owner).status_code == 409


@pytest.mark.asyncio
async def test_unnumbered_question_with_missing_figure_is_still_held(monkeypatch):
    async def model(prompt, image=None):
        if prompt.startswith("Xác định cấu trúc"):
            return '{"complete":false,"questions":[]}'
        assert prompt.startswith("Xác minh dữ liệu OCR")
        return json.dumps({"complete": False, "reason": "Thiếu hình tam giác được nhắc trong đề."})

    monkeypatch.setattr(exam_grading, "exam_json", model)
    from app.schemas.exam import PageReading

    result = await exam_grading.analyze_submission([], page_readings=[
        PageReading(role="exam", file="de.png", page=1, readable=True, text="Dựa vào hình bên, hãy tính diện tích tam giác."),
        PageReading(role="answer", file="bai.png", page=1, readable=True, text="Diện tích là 18 cm²."),
    ])
    assert result.state == "needs_review" and result.total is None
    assert result.reason == "Thiếu hình tam giác được nhắc trong đề."


def test_missing_and_invalid_uploads(exam_db):
    engine, client = exam_db
    install_exam_schema(engine)
    _, auth = account(engine, "Học sinh")
    files = uploads()
    assert client.post("/api/exams/submissions", files=files[1:2], headers=auth).status_code == 422
    invalid = ("answer_files", ("not.png", b"<html>test", "image/png"))
    assert client.post("/api/exams/submissions", files=[files[0], invalid], headers=auth).status_code == 422
    assert client.get("/api/exams/history", headers=auth).json() == []


def test_generated_rubric_fits_the_question_scale_exactly():
    key = GradingKey(id="1", solution="Giải", rubric=[
        {"label": "Phương pháp", "max_points": 1},
        {"label": "Lập luận", "max_points": 1},
        {"label": "Kết quả", "max_points": 1},
    ])
    allocated = exam_grading.fit_generated_rubric(key, Decimal("2"))
    assert [item.max_points for item in allocated.rubric] == [Decimal("0.67"), Decimal("0.67"), Decimal("0.66")]


def test_native_pdf_questions_use_the_embedded_text_but_answers_keep_the_image():
    question = "Question 1: Solve 2x = 4 and show the two steps."
    with fitz.open() as pdf:
        page = pdf.new_page()
        page.insert_text((40, 50), question)
        content = pdf.tobytes()
    exam, answer = render_uploads([
        ExamUpload("exam", "de.pdf", "application/pdf", content),
        ExamUpload("answer", "bai.pdf", "application/pdf", content),
    ])
    assert exam.native_text == question
    assert answer.native_text == ""
    assert answer.image.startswith(b"\xff\xd8\xff")


def test_typed_essay_never_saves_a_fallback_score(exam_db, monkeypatch):
    engine, client = exam_db
    _, auth = account(engine, "Học sinh")

    async def invalid_grade(*args):
        return {"scores": []}

    monkeypatch.setattr(llm_manager, "grade_essay", invalid_grade)
    response = client.post("/api/essays/grade", headers=auth, json={
        "prompt": "Tính x", "rubric": [{"criterion": "Phương pháp", "max": 2}], "essay": "x = 2",
    })
    assert response.status_code == 503
    assert client.get("/api/essays/", headers=auth).json()["essays"] == []


@pytest.mark.parametrize(("prompt", "answer", "rubric", "expected"), [
    ("11 + 1 = ?", "11 + 1 = 12", "đúng - 10", 10),
    ("11 + 1 = ?", "11 + 1 = 13", "đúng - 10", 0),
    ("11 + 1 = ?", "11 + 1 = 13 = 12", "đúng - 10", 0),
    ("Tính 0,1 + 0,2", "Đáp số: 0,3", "Kết quả đúng - 7", 7),
    ("(5 − 1) × 2 = ?", "8", "đúng - 10", 10),
    ("1 ÷ 3 = ?", "1/3", "đúng - 10", 10),
    ("11 = 10 + x\nvậy x = ?", "x=1", "đúng - 10", 10),
    ("11 = 10 + x\nvậy x = ?", "x=2", "đúng - 10", 0),
    ("Tìm x: 2(x - 1) = 5", "Vậy: x = 7/2", "Kết quả đúng - 7", 7),
    ("Giải phương trình 3y + 4 = y - 2", "y = -3", "Đáp án đúng - 10", 10),
    ("Tìm t biết t + 0,5 = 1", "Đáp số: t = 1/2", "đúng - 10", 10),
    ("11 = 10 + x\nx = ?", "11 - 10 = 1\n⇒ x = 1", "đúng - 10", 10),
])
def test_typed_calculation_grades_exactly_without_an_llm(exam_db, monkeypatch, prompt, answer, rubric, expected):
    engine, client = exam_db
    _, auth = account(engine, "Học sinh")

    async def unexpected_model_call(*args):
        raise AssertionError("An exact arithmetic check should not require a model.")

    monkeypatch.setattr(llm_manager, "grade_essay", unexpected_model_call)
    response = client.post("/api/essays/grade", headers=auth, json={
        "prompt": prompt, "rubric": rubric, "essay": answer,
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["mode"] == "calculation"
    assert data["total"] == data["scores"][0]["score"] == expected
    assert data["scores"][0]["quote"] == answer
    if prompt.startswith("11 = 10 + x"):
        assert data["scores"][0]["feedback"] == "Nghiệm của phương trình là x = 1."
    assert client.get("/api/essays/", headers=auth).json()["essays"][0]["total"] == expected


@pytest.mark.parametrize("prompt", [
    "x*x = 1", "4/x = 2", "x + 1 = x + 1", "x + 1 = x + 2", "x + y = 2", "Tìm y: x + 1 = 2",
])
def test_calculation_only_solves_supported_equations_with_a_unique_answer(prompt):
    assert check_equation(prompt, "x = 1") is None


def test_calculation_does_not_replace_rubrics_that_assess_explanation(exam_db, monkeypatch):
    engine, client = exam_db
    _, auth = account(engine, "Học sinh")

    async def grade_by_rubric(prompt, rubric_json, answer):
        assert prompt == "11 = 10 + x" and answer == "x = 1"
        assert len(json.loads(rubric_json)) == 2
        return {"scores": [{"score": 8}, {"score": 0}], "overall": "Kết quả đúng. Cần giải thích."}

    monkeypatch.setattr(llm_manager, "grade_essay", grade_by_rubric)
    response = client.post("/api/essays/grade", headers=auth, json={
        "prompt": "11 = 10 + x", "rubric": "Đúng - 8\nGiải thích cách tính - 2", "essay": "x = 1",
    })
    assert response.status_code == 200
    assert response.json()["mode"] == "llm"
    assert response.json()["total"] == 8


def test_classroom_submit_review_regrade_and_finalize(exam_db, monkeypatch):
    engine, client = exam_db
    install_exam_schema(engine)
    _, teacher = account(engine, "Giáo viên", "teacher")
    _, other_teacher = account(engine, "Giáo viên khác", "teacher")
    student_id, student = account(engine, "Học sinh")
    _, other_student = account(engine, "Bạn cùng lớp")
    _, outsider = account(engine, "Người ngoài")
    room = client.post("/api/classes/", headers=teacher, json={"name": "Lớp thử"}).json()
    for member in (student, other_student, other_teacher):
        assert client.post("/api/classes/join", headers=member, json={"code": room["code"]}).status_code == 200
    base = f"/api/classes/{room['id']}"
    path = base + "/assignments"
    questions = [
        {"id": "1", "prompt": "Chọn", "max_points": 2, "options": {"A": "Đáp án A", "B": "Đáp án B"},
         "correct_options": ["A"], "solution": "Chọn A."},
        {"id": "2", "prompt": "Giải $2x=4$.", "max_points": 8, "rubric": [{"label": "Tính x", "max_points": 8}],
         "solution": "Chia hai vế cho 2."},
    ]
    payload = {"title": "Đề kết hợp", "questions": questions}
    assert client.post(path, json=payload, headers=student).status_code == 403
    assert client.post(path, json=payload, headers=other_teacher).status_code == 404
    assert client.get(path, headers=outsider).status_code == 404
    result = client.post(path, json=payload, headers=teacher)
    assert result.status_code == 201, result.text
    assignment_id = result.json()["id"]
    assert result.json()["questions"][0]["correct_options"] == ["A"]
    assignment_path = path + "/" + assignment_id
    detail = client.get(assignment_path, headers=student).json()
    assert all("correct_options" not in question and "rubric" not in question and "solution" not in question
               for question in detail["questions"])
    submission_path = assignment_path + "/submissions"
    monkeypatch.setattr(exam_grading, "exam_json", model_response())
    files = uploads()[1:2]
    assert client.post(submission_path, files=files, headers=outsider).status_code == 404
    assert client.post(submission_path, files=files, headers=teacher).status_code == 403
    result = client.post(submission_path, files=files, headers=student)
    assert result.status_code == 201, result.text
    submitted = result.json()
    submission_id = submitted["id"]
    assert Decimal(submitted["ai_total"]) == Decimal("8.25")
    assert submitted["official"] is None
    assert not submitted["analysis"]["grades"] and not submitted["analysis"]["pages"]
    assert client.get(path, headers=student).json()[0]["submission_id"] == submission_id
    assert client.get(path, headers=teacher).json()[0]["submission_count"] == 1
    assert client.get("/api/exams/history", headers=student).json() == []
    assert client.post(submission_path, files=files, headers=student).status_code == 409
    assert client.get(submission_path, headers=student).status_code == 403
    assert client.get(submission_path, headers=other_teacher).status_code == 404
    assert client.get(submission_path, headers=teacher).json()[0]["student_name"] == "Học sinh"
    detail_path = "/api/exams/submissions/" + submission_id
    assert client.get(detail_path, headers=other_student).status_code == 403
    assert client.get(detail_path, headers=other_teacher).status_code == 404
    teacher_view = client.get(detail_path, headers=teacher).json()
    assert teacher_view["analysis"]["grades"][0]["correct_options"] == ["A"]
    assert teacher_view["analysis"]["pages"][0]["readable"]
    original = detail_path + "/files/" + submitted["files"][0]["id"]
    assert client.get(original, headers=teacher).content == files[0][1][1]
    assert client.get(original, headers=other_teacher).status_code == 404

    mutation_path = submission_path + "/" + submission_id
    assert client.post(mutation_path + "/regrade", json={"revision": 1}, headers=student).status_code == 403
    regrade = client.post(mutation_path + "/regrade", json={"revision": 1}, headers=teacher)
    assert regrade.status_code == 200, regrade.text
    assert regrade.json()["revision"] == 2
    scores = [{"id": "1", "points": 2}, {"id": "2", "points": "7.50"}]
    finalize = {"revision": 2, "scores": scores, "comment": "Kiểm tra nghiệm sau khi giải."}
    assert client.post(mutation_path + "/finalize", json=finalize | {"revision": 1}, headers=teacher).status_code == 409
    assert client.post(mutation_path + "/finalize", json=finalize | {
        "scores": [scores[0], {"id": "2", "points": 9}],
    }, headers=teacher).status_code == 422
    assert client.post(mutation_path + "/finalize", json=finalize, headers=teacher).status_code == 200
    student_view = client.get(detail_path, headers=student).json()
    assert student_view["state"] == "finalized"
    assert Decimal(student_view["official"]["total"]) == Decimal("9.50")
    assert Decimal(student_view["ai_total"]) == Decimal("8.25")
    assert "nghiệm" in student_view["official"]["comment"]
    assert client.post(mutation_path + "/regrade", json={"revision": 3}, headers=teacher).status_code == 409

    with Session(engine) as db:
        db.add(Essay(user_id=student_id, class_id=None, prompt="Riêng tư", rubric="[]", essay="Riêng tư", status="pending"))
        db.commit()
    assert client.get(base + "/members", headers=student).status_code == 403
    assert client.get(base + "/essays/pending", headers=other_teacher).status_code == 404
    assert client.get(base + "/essays/pending", headers=teacher).json()["essays"] == []
