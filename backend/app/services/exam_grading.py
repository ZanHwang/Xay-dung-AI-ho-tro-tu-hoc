import asyncio
import json
import re
import unicodedata
from decimal import Decimal
from typing import Annotated, TypeVar

from pydantic import BaseModel, Field, ValidationError

from app.ai.vision import exam_json
from app.schemas.exam import (
    AnalysisOut, Criterion, CriterionScore, GradingKey, ObservedChoice, PageReading, Points, PositivePoints, Question,
    QuestionDraft, QuestionGrade, QuestionId, QuestionReview, RecognizedAnswer, TeacherQuestion, Text,
)
from app.services.exam_uploads import ExamPage

CENT = Decimal("0.01")
Model = TypeVar("Model", bound=BaseModel)
ExamTotalPoints = Annotated[Decimal, Field(gt=0, le=5000, decimal_places=2)]


class ReviewRequired(Exception):
    pass


class OcrResult(BaseModel):
    readable: bool
    text: str = Field(max_length=18000)
    choices: list[ObservedChoice] = Field(default_factory=list, max_length=50)


class ExamReading(BaseModel):
    complete: bool
    reason: str = Field(default="", max_length=1000)
    questions: list[QuestionDraft] = Field(max_length=50)
    total_points: ExamTotalPoints | None = None


class StandaloneWrittenReading(BaseModel):
    complete: bool
    printed_points: PositivePoints | None = None
    reason: str = Field(default="", max_length=1000)


class PartialQuestion(QuestionDraft):
    review_reason: str = Field(default="", max_length=1000)
    excerpt: str = Field(default="", max_length=12000)


class PartialExamReading(BaseModel):
    questions: list[PartialQuestion] = Field(max_length=50)


class PartialKeyReading(BaseModel):
    keys: list[GradingKey] = Field(default_factory=list, max_length=50)
    reviews: list[QuestionReview] = Field(default_factory=list, max_length=50)


class AnswerMatch(RecognizedAnswer):
    evidence_lines: list[int] = Field(default_factory=list, max_length=12)


class AnswerReading(BaseModel):
    complete: bool
    reason: str = Field(default="", max_length=1000)
    answers: list[AnswerMatch] = Field(max_length=50)


class KeyReading(BaseModel):
    complete: bool
    keys: list[GradingKey] = Field(max_length=50)


class VerifiedChoice(BaseModel):
    id: QuestionId
    correct_options: list[str] = Field(min_length=1, max_length=12)


class ChoiceVerification(BaseModel):
    complete: bool
    choices: list[VerifiedChoice] = Field(max_length=50)


class OfficialKey(GradingKey):
    evidence: Text


class OfficialReading(BaseModel):
    readable: bool
    keys: list[OfficialKey] = Field(max_length=50)
    missing: list[QuestionId] = Field(max_length=50)


class CriterionMark(BaseModel):
    index: int = Field(ge=1, le=12)
    points: Points
    quote: str = Field(default="", max_length=2000)
    feedback: Text


class WrittenMark(BaseModel):
    readable: bool
    scores: list[CriterionMark] = Field(max_length=12)
    feedback: Text
    correction: str = Field(default="", max_length=12000)


class ChoiceFeedback(BaseModel):
    supported: bool
    correction: Text


PAGE_PROMPTS = {
    "exam": "Đọc đề in, số thứ tự, điểm in, tất cả lựa chọn và dữ kiện của hình vẽ/biểu đồ.",
    "answer": (
        "Đọc nguyên văn chữ viết tay và bài tính theo thứ tự. Ghi rõ số câu và những phương án "
        "thực sự được khoanh/tô, lần sửa hoặc tẩy. Ghi cả câu được thấy là bỏ trống. "
        "Bảng tô đáp án phải được đọc theo đúng hàng và cột. Phân biệt chữ cái in sẵn "
        "với chữ nằm trong vòng tròn vẽ tay, vùng được tô, hoặc viết riêng để trả lời. "
        "Ghi các dấu chọn rõ vào choices, ví dụ [{\"label\":\"1\",\"selected_options\":[\"B\"]}]. "
        "Nếu dấu khoanh nằm cạnh phương án in, chép nguyên văn phần chữ hoặc số cạnh dấu "
        "vào option_text theo từng chữ cái, ví dụ {\"B\":\"64 tuổi\"}. Để trống khi chữ cạnh dấu bị mờ. "
        "Chỉ đặt letter_only=true cho phiếu riêng chỉ có ô/chữ cái đáp án, không chứa nội dung phương án. "
        "Đánh dấu readable=false nếu có phần không rõ, nhưng vẫn trả về các dấu chọn đã đọc chắc. "
        "Chỉ ghi chữ thực sự được chọn, giữ nguyên số câu; dùng A cho Đúng và B cho Sai. "
        "Không đưa dãy phương án in sẵn, tiêu đề, ký hiệu hoặc lời giải tự luận vào choices."
    ),
    "official": "Đọc nguyên văn đáp án chính thức, mã đề, lời giải, tiêu chí và điểm từng ý.",
}


async def read_json(schema: type[Model], prompt: str, failure: str, image: bytes | None = None) -> Model:
    response = await exam_json(prompt, image)
    if response:
        try:
            return schema.model_validate_json(response)
        except ValidationError:
            pass
    raise ReviewRequired(failure)


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def normalized(text: str) -> str:
    return " ".join(text.split())


def normalized_quote(text: str) -> str:
    text = unicodedata.normalize("NFC", text).translate(str.maketrans("−–—", "---"))
    for delimiter in ("$", r"\(", r"\)", r"\[", r"\]"):
        text = text.replace(delimiter, "")
    return re.sub(r"\s*([=+×÷-])\s*", r"\1", normalized(text))


def normalized_option(text: str) -> str:
    return normalized_quote(text).casefold().strip(" .;:")


def option_text_matches(choice: ObservedChoice, question: Question) -> bool:
    return all(
        letter in question.options and normalized_option(text) == normalized_option(question.options[letter])
        for letter, text in choice.option_text.items()
    )


def multiple_correct_options(question: Question, *keys: GradingKey) -> bool:
    if question.allows_multiple_options:
        return False
    if any(len(set(key.correct_options)) > 1 for key in keys):
        return True
    # Check a simple integer interval directly, since an AI can stop at the first match.
    bounds = re.fullmatch(
        r"(?:(?:bài|câu) [0-9]+[.:] )?(?:tìm )?số có (?:hai|2) chữ số "
        r"(bé|nhỏ|lớn) hơn ([0-9]{1,4}) và (bé|nhỏ|lớn) hơn ([0-9]{1,4})(?: là)?",
        normalized_option(question.prompt).rstrip("?"),
    )
    if bounds is None:
        return False
    first_is_lower = bounds[1] == "lớn"
    if first_is_lower == (bounds[3] == "lớn"):
        return False
    first, second = int(bounds[2]), int(bounds[4])
    lower, upper = (first, second) if first_is_lower else (second, first)
    values = [normalized_option(option) for option in question.options.values()]
    return sum(1 for value in values if re.fullmatch(r"[1-9][0-9]", value) and lower < int(value) < upper) > 1


def age_difference_key(question: Question) -> GradingKey | None:
    match = re.fullmatch(
        r"(?:(?:bài|câu) [0-9]+[.:] )?(?P<older>[^,.?]+?) năm nay (?P<age>[0-9]{1,3}) tuổi[,.;] "
        r"(?P<again>[^,.?]+?) hơn (?P<younger>[^,.?]+?) (?P<difference>[0-9]{1,3}) tuổi[.?!] "
        r"hỏi (?P=younger) năm nay bao nhiêu tuổi\??",
        normalized_option(question.prompt),
    )
    if match is None:
        return None
    older, again = match["older"], match["again"]
    age, difference = int(match["age"]), int(match["difference"])
    if (again != older and not older.startswith(again + " ")) or age < difference:
        return None
    remaining = age - difference
    correct = [letter for letter, option in question.options.items()
               if normalized_option(option) in {str(remaining), f"{remaining} tuổi"}]
    if not correct:
        return None
    return GradingKey(id=question.id, correct_options=correct,
                      solution=f"{match['younger'].capitalize()} năm nay {age} − {difference} = {remaining} tuổi.")


def extreme_number_key(question: Question) -> GradingKey | None:
    match = re.fullmatch(
        r"(?:(?:bài|câu) [0-9]+[.:] )?(?:chọn số|trong các số) "
        r"([0-9]{1,6}(?:\s*[;,]\s*[0-9]{1,6})+)\s*[,;.] "
        r"(?:hỏi )?số (lớn|bé|nhỏ) nhất(?: trong các số đó)? là",
        normalized_option(question.prompt).rstrip("?"),
    )
    if match is None:
        return None
    values = [int(value) for value in re.findall(r"[0-9]+", match[1])]
    extreme = max(values) if match[2] == "lớn" else min(values)
    correct = [letter for letter, option in question.options.items() if normalized_option(option) == str(extreme)]
    if not correct:
        return None
    return GradingKey(id=question.id, correct_options=correct,
                      solution=f"{extreme} là số {match[2]} nhất trong dãy số đã cho.")


def by_id(items) -> dict:
    indexed = {item.id: item for item in items}
    if len(indexed) != len(items):
        raise ReviewRequired("Có mã câu trùng lặp. Hãy kiểm tra lại thứ tự và ảnh các trang.")
    return indexed


async def read_pages(pages: list[ExamPage], limiter: asyncio.Semaphore) -> list[PageReading]:
    async def read(page: ExamPage) -> PageReading:
        if page.native_text:
            return PageReading(role=page.role, file=page.name, page=page.number, readable=True, text=page.native_text)
        prompt = (
            f"{PAGE_PROMPTS[page.role]} Chép đúng dữ liệu thấy được, công thức dùng LaTeX trong $...$. "
            "Không giải, không sửa nội dung và không điền phần thiếu. Đánh dấu [không đọc được] "
            "ở chỗ mơ hồ, thiếu góc, mất dòng hoặc không phân biệt được dấu chọn. "
            "Nếu đây thực sự là một trang trống nhưng ảnh rõ, ghi [trang trống]. "
            'Trả JSON dạng {"readable": true, "text": "nội dung", "choices": []}; '
            "chỉ điền choices cho trang bài làm và đặt readable=false khi còn phần quan trọng không chắc."
        )
        try:
            async with limiter:
                result = await read_json(OcrResult, prompt, "OCR chưa đọc được trang.", page.image)
            readable = result.readable and bool(result.text.strip()) and "[không đọc được]" not in result.text.lower()
            return PageReading(
                role=page.role, file=page.name, page=page.number, readable=readable, text=result.text,
                choices=[item for item in result.choices if item.selected_options] if page.role == "answer" else [],
            )
        except ReviewRequired:
            return PageReading(role=page.role, file=page.name, page=page.number, readable=False, text="")

    return list(await asyncio.gather(*(read(page) for page in pages)))


def question_points(reading: ExamReading) -> list[Question]:
    if not reading.complete or not reading.questions:
        raise ReviewRequired(reading.reason or "Chưa xác định được đầy đủ đề thi.")
    by_id(reading.questions)
    printed = sum((q.max_points for q in reading.questions if q.max_points is not None), Decimal(0))
    missing = sum(q.max_points is None for q in reading.questions)
    if not missing:
        if reading.total_points is not None and reading.total_points != printed:
            raise ReviewRequired("Tổng điểm trên đề không khớp với điểm từng câu.")
        return [Question.model_validate(q.model_dump()) for q in reading.questions]
    if reading.total_points is None and printed:
        raise ReviewRequired("Chưa xác định được điểm của các câu còn lại trong đề.")
    budget = (reading.total_points if reading.total_points is not None else Decimal(10)) - printed
    units, remainder = divmod(int(budget / CENT), missing)
    if units <= 0 or budget > 100 * missing:
        raise ReviewRequired("Thang điểm trên đề không đủ hoặc không phù hợp với số câu.")
    questions = []
    for question in reading.questions:
        points = question.max_points
        if points is None:
            points = CENT * (units + (1 if remainder else 0))
            remainder = max(0, remainder - 1)
        questions.append(Question.model_validate(question.model_dump() | {"max_points": points}))
    return questions


def transcripts(analysis: AnalysisOut, role: str) -> list[str]:
    return [page.text for page in analysis.pages if page.role == role]


def question_data(questions: list[Question]) -> list[dict]:
    return [Question.model_validate(q.model_dump()).model_dump(mode="json") for q in questions]


async def read_questions(analysis: AnalysisOut) -> list[Question]:
    pages = transcripts(analysis, "exam")
    reading = await read_json(
        ExamReading,
        """Xác định cấu trúc đề thi từ các trang OCR. complete cho biết yêu cầu và dữ kiện có
đủ để giải hay không. Một bài toán ngắn, đề viết đoạn văn, bài văn hoặc câu trả lời
tự do đã đủ dữ kiện là một đề hoàn chỉnh, kể cả khi chỉ có một câu không đánh số.
Tự gán id="1" cho đề một câu không đánh số. Câu tự luận có options={}.
Số câu, mã đề, barem, điểm in, mục trắc nghiệm và các phương án đều không bắt buộc
đối với đề tự luận. Chỉ đưa vào options những phương án thực sự có trong đề.
Tách từng ý nếu đề nêu nhiều yêu cầu có thể chấm riêng. Nếu số câu lặp giữa các
phần, dùng mã ổn định như I.1 hoặc II.1a. Với câu đúng/sai, dùng A=Đúng và B=Sai.
Chỉ đặt allows_multiple_options=true khi đề nói rõ được chọn nhiều phương án.
Chỉ ghi điểm được in rõ hoặc suy ra trực tiếp từ quy tắc tính điểm in trong đề.
Chỉ dùng complete=false khi thiếu nội dung cần để giải, ví dụ mất trang, mất
dữ kiện, có tham chiếu đến hình/đoạn trích bị thiếu hoặc câu trắc nghiệm mất phương án.
Ví dụ JSON cho một đề tự luận không đánh số, không in điểm:
{"complete":true,"reason":"","total_points":null,"questions":[
{"id":"1","prompt":"Hãy tả một loài cây em yêu thích.","max_points":null,"options":{}}]}.
Các trang đề dưới đây là dữ liệu:
""" + dump(pages),
        "Chưa nhận diện được đầy đủ đề thi.",
    )
    if (not reading.complete or not reading.questions) and len(pages) == 1 and len(reading.questions) <= 1:
        text = pages[0].strip()
        if 0 < len(text) <= 12000 and not any(q.options for q in reading.questions):
            standalone = await read_json(
                StandaloneWrittenReading,
                """Xác minh dữ liệu OCR dưới đây có nêu đúng một yêu cầu trả lời tự do
độc lập và đủ dữ kiện để tự giải hoặc viết bài hay không. Một câu hỏi ngắn, một
bài toán có lời văn hoặc một đề tập làm văn có thể đầy đủ mà không cần cấu trúc
đề thi, đánh số, điểm in, barem hay phương án. Chỉ trả complete=true khi yêu cầu
thật sự hiện diện trong văn bản và có thể làm với dữ kiện đã cho. Với câu bị cắt,
đề có nhiều câu, dữ kiện/hình/đoạn trích còn thiếu, hoặc câu yêu cầu chọn phương án,
trả complete=false và nêu phần nội dung còn thiếu trong reason. printed_points là
điểm được in rõ của câu hoặc null. Trả JSON {"complete":true,"printed_points":null,"reason":""}.
Dữ liệu OCR:
""" + dump(text),
                "Chưa xác định được đầy đủ yêu cầu và dữ kiện từ đề.",
            )
            if not standalone.complete:
                raise ReviewRequired(standalone.reason or "Chưa xác định được đầy đủ yêu cầu và dữ kiện từ đề.")
            reading = ExamReading(
                complete=True,
                questions=[QuestionDraft(id="1", prompt=text, max_points=standalone.printed_points)],
            )
    return question_points(reading)


async def read_answers(analysis: AnalysisOut) -> list[RecognizedAnswer]:
    source_lines = {}
    marked_lines = {}
    for page in analysis.pages:
        if page.role != "answer":
            continue
        for line in page.text.splitlines():
            if line.strip():
                source_lines[len(source_lines) + 1] = line.strip()
        for mark in observed_choices(page):
            line_number = len(source_lines) + 1
            source_lines[line_number] = f"Dấu chọn câu {mark.label}: {', '.join(mark.selected_options)}"
            marked_lines[line_number] = mark
    reading = await read_json(
        AnswerReading,
        """Ghép bài làm OCR theo đúng mã và thứ tự câu hỏi. Không giải đề và không suy diễn chữ
hoặc lựa chọn. Ghi đủ mọi mã câu. Chỉ dùng blank khi phiếu hiển thị rõ câu bỏ trống
hoặc tất cả trang bài làm rõ, đủ và câu thực sự không làm. Khi thiếu trang, ánh xạ
mơ hồ hoặc có dấu khoanh/tô không xác định, dùng unreadable và complete=false.
Nếu đề có đúng một câu tự luận và bài làm liền mạch, gán phần bài làm vào id đó
dù học sinh không ghi số câu hay chỉ ghi phép tính, đoạn văn hoặc đáp số.
Nếu nhiều lựa chọn được đánh dấu rõ thì ghi tất cả, kể cả khi câu chỉ có một đáp án.
Với đúng/sai, dùng A cho Đúng và B cho Sai khi đề đã quy ước như vậy.
Đối với câu tự luận kể cả câu trả lời ngắn, chép nguyên văn vào text.
Mọi câu đã làm phải có evidence_lines lấy từ số dòng OCR. Đối với đáp án trắc nghiệm,
chỉ lấy các dòng "Dấu chọn câu ..." làm bằng chứng, vì phương án in sẵn có thể chưa
được chọn. Không dùng số câu thay cho số dòng.
Trả JSON {"complete":true,"reason":"","answers":[
{"id":"1","status":"answered","text":"Lời giải chép từ OCR","selected_options":[],"evidence_lines":[1]}]}.
Đề và bài làm:
""" + dump({"questions": question_data(analysis.questions), "ocr_lines": source_lines}),
        "Chưa nhận diện được bài làm.",
    )
    analysis.answers = [
        RecognizedAnswer.model_validate(match.model_dump() | {
            "evidence": "\n".join(source_lines[line] for line in sorted(set(match.evidence_lines)) if line in source_lines)[:2000],
        })
        for match in reading.answers
    ]
    answers = by_id(analysis.answers)
    matches = by_id(reading.answers)
    if not reading.complete or answers.keys() != {q.id for q in analysis.questions}:
        raise ReviewRequired(reading.reason or "Chưa đối chiếu được bài làm với tất cả câu hỏi.")
    for question in analysis.questions:
        answer = answers[question.id]
        options = set(answer.selected_options)
        references = set(matches[question.id].evidence_lines)
        if (
            answer.status == "unreadable"
            or options - question.options.keys()
            or len(options) != len(answer.selected_options)
            or (answer.status == "blank" and (options or answer.text.strip()))
            or (answer.status == "answered" and not (options if question.options else answer.text.strip()))
            or (answer.status == "answered" and (not references or references - source_lines.keys()))
            or (options and not any(
                line in marked_lines and set(marked_lines[line].selected_options) == options
                and option_text_matches(marked_lines[line], question) for line in references
            ))
        ):
            raise ReviewRequired(f"Chưa xác định chắc chắn bài làm câu {question.id}.")
    return [answers[q.id] for q in analysis.questions]


def fit_generated_rubric(key: GradingKey, maximum: Decimal) -> GradingKey:
    weight = sum(item.max_points for item in key.rubric)
    if not weight or weight == maximum:
        return key
    units = int(maximum / CENT)
    distributable = units - len(key.rubric)
    if distributable < 0:
        raise ReviewRequired(f"Thang điểm câu {key.id} quá nhỏ cho số tiêu chí được đề xuất.")
    shares = [item.max_points * distributable / weight for item in key.rubric]
    whole = [int(share) for share in shares]
    order = sorted(range(len(shares)), key=lambda index: shares[index] - whole[index], reverse=True)
    for index in order[:distributable - sum(whole)]:
        whole[index] += 1
    return key.model_copy(update={
        "rubric": [
            Criterion(label=item.label, max_points=CENT * (cents + 1))
            for item, cents in zip(key.rubric, whole)
        ],
    })


async def build_keys(analysis: AnalysisOut) -> dict[str, tuple[GradingKey, str]]:
    keys = {}
    questions = by_id(analysis.questions)
    if official_pages := transcripts(analysis, "official"):
        official = await read_json(
            OfficialReading,
            """Đối chiếu đề với tài liệu đáp án chính thức. Chép đáp án và barem có trong tài liệu;
không tự giải ở bước này. Kiểm tra mã đề và khớp mã câu. Chỉ ghi vào missing khi chắc chắn
tài liệu không đề cập câu đó. Câu có đáp án mơ hồ, mã đề sai hoặc barem mâu thuẫn làm
readable=false. Nếu có lời giải nhưng không có điểm từng ý, dùng một tiêu chí duy nhất
ghi yêu cầu của lời giải với điểm tối đa của câu. evidence phải là trích dẫn nguyên văn,
gồm phần định danh câu và đáp án/tiêu chí, từ một trang tài liệu chính thức.
Trả JSON {"readable":true,"missing":[],"keys":[{"id":"1","correct_options":["A"],
"rubric":[],"solution":"Lời giải hoặc đáp án ghi trong tài liệu","evidence":"Câu 1: A"}]}.
rubric gồm {"label":"...","max_points":1}; câu tự luận có correct_options=[].
Dữ liệu:
""" + dump({"questions": question_data(analysis.questions), "official_pages": official_pages}),
            "Chưa đối chiếu được tài liệu đáp án chính thức.",
        )
        provided = by_id(official.keys)
        if (
            not official.readable or not provided or provided.keys() & set(official.missing)
            or provided.keys() | set(official.missing) != questions.keys()
        ):
            raise ReviewRequired("Đáp án chính thức không khớp đề hoặc còn nội dung chưa đọc rõ.")
        for key in official.keys:
            if not any(normalized(key.evidence) in normalized(page) for page in official_pages):
                raise ReviewRequired(f"Chưa tìm được bằng chứng trong đáp án chính thức cho câu {key.id}.")
            keys[key.id] = (key, "official")

    unresolved = [q for q in analysis.questions if q.id not in keys]
    if unresolved:
        solved = await read_json(
            KeyReading,
            """Tự giải các câu cần chấm dựa trên đề dưới đây. Với trắc nghiệm, kiểm tra từng
phương án và ghi tất cả phương án đúng, kể cả khi đề dự kiến chỉ có một. Nếu
phải đoán chữ, số hoặc hình chưa có trong đề thì complete=false. Với tự luận, để correct_options=[] và
sinh barem phù hợp yêu cầu. Bài toán có lời văn có thể chấm phép tính, kết quả và
đơn vị. Đề viết văn có thể chấm mức độ đáp ứng yêu cầu, tổ chức ý và diễn đạt.
Barem chỉ gồm những tiêu chí có căn cứ từ đề, với tổng max_points bằng điểm của câu. Đưa lời giải, bước sửa
và lý do bằng tiếng Việt trong solution, toán dùng LaTeX. Không tự đặt thêm giả thiết khi thiếu dữ kiện.
Nếu có câu chưa thể giải chắc chắn, complete=false.
Trả JSON {"complete":true,"keys":[{"id":"1","correct_options":[],
"rubric":[{"label":"...","max_points":1}],"solution":"..."}]}.
Dữ liệu:
""" + dump(question_data(unresolved)),
            "AI chưa giải được đề hoặc chưa lập được barem đầy đủ.",
        )
        if not solved.complete or by_id(solved.keys).keys() != {q.id for q in unresolved}:
            raise ReviewRequired("AI chưa xác định được đáp án và barem của tất cả câu hỏi.")
        keys.update({key.id: (key, "ai") for key in solved.keys})
        choice_questions = [question for question in unresolved if question.options]
        if choice_questions:
            verification = await read_json(
                ChoiceVerification,
                """Kiểm chứng độc lập các câu trắc nghiệm. Xét từng phương án, thử ngược kết
quả vào đề khi có thể. Liệt kê tất cả phương án đúng, kể cả khi đề dự kiến chỉ có một. Nếu dữ kiện không đủ hoặc
không chắc, complete=false. Trả JSON {"complete":true,"choices":[
{"id":"1","correct_options":["A"]}]}. Nội dung đề:
""" + dump(question_data(choice_questions)),
                "Chưa kiểm chứng được các đáp án trắc nghiệm do AI lập.",
            )
            checked = by_id(verification.choices)
            if not verification.complete or checked.keys() != {q.id for q in choice_questions}:
                raise ReviewRequired("Chưa kiểm chứng được các đáp án trắc nghiệm do AI lập.")
            for question in choice_questions:
                if set(checked[question.id].correct_options) != set(keys[question.id][0].correct_options):
                    raise ReviewRequired(f"Hai lượt giải câu {question.id} chưa thống nhất. Hãy kiểm tra lại câu này.")
    for question_id, (key, source) in keys.items():
        question = questions[question_id]
        if source == "ai":
            if question.options:
                key = key.model_copy(update={"rubric": []})
                if multiple_correct_options(question, key):
                    raise ReviewRequired(f"Câu {question.id} có nhiều phương án phù hợp. Hãy kiểm tra đề.")
            else:
                key = fit_generated_rubric(key.model_copy(update={"correct_options": []}), question.max_points)
        try:
            key.validate_for(question)
        except ValueError as exc:
            raise ReviewRequired(str(exc)) from exc
        keys[question_id] = (key, source)
    return keys


def choice_label(text: str) -> str:
    return re.sub(r"^(?:bài|câu)\s+", "", text.strip().casefold()).strip(" .:")


def observed_choices(page: PageReading) -> list[ObservedChoice]:
    parts = re.split(r"(?im)^[ \t]*(?:bài|câu)[ \t]+([0-9]+[a-z]?)[.:][ \t]*", page.text)[1:]
    blocks = {}
    for label, text in zip(parts[::2], parts[1::2]):
        blocks.setdefault(label.casefold(), []).append(text)

    observations = []
    for mark in page.choices:
        sections = blocks.get(choice_label(mark.label), [])
        if mark.option_text or mark.letter_only or len(sections) != 1:
            observations.append(mark)
            continue
        printed = re.findall(
            r"(?<!\w)([A-L])\s*[.):]\s*(.*?)(?=(?<!\w)[A-L]\s*[.):]|\Z)",
            sections[0], flags=re.DOTALL,
        )
        option_text = {letter: text.strip() for letter, text in printed if text.strip()}
        if len(printed) == len(option_text) and option_text.keys() == set(mark.selected_options):
            mark = mark.model_copy(update={"option_text": option_text})
        observations.append(mark)
    return observations


def recoverable_choice_marks(pages: list[PageReading]) -> list[ObservedChoice]:
    exam_pages = [page for page in pages if page.role == "exam"]
    if (
        not exam_pages or not all(page.readable for page in exam_pages)
        or any(page.role == "official" for page in pages)
    ):
        return []
    marks = [mark for page in pages if page.role == "answer" for mark in observed_choices(page)]
    return marks if any(mark.option_text or mark.letter_only for mark in marks) else []


async def grade_readable_choices(analysis: AnalysisOut) -> None:
    marks = recoverable_choice_marks(analysis.pages)
    if not marks:
        return

    exam_pages = transcripts(analysis, "exam")
    reading = await read_json(
        PartialExamReading,
        """Tách các câu hiện diện trong OCR của đề thi, kể cả khi một vài câu bị thiếu dữ kiện.
Giữ nguyên số câu, phép tính và các phương án. Ghi review_reason riêng cho câu có hình
hoặc đoạn trích chưa được mô tả, chữ số bị mờ, phương án bị thiếu hay dữ kiện mâu thuẫn.
Ghi rõ lý do cần đối chiếu ảnh gốc khi bản chép không đủ để giải. Không suy diễn
chữ/số hoặc tự thay dữ kiện. Đổi nhãn phương án a,b,c,d sang A,B,C,D.
Chỉ đặt allows_multiple_options=true khi đề yêu cầu chọn nhiều phương án.
excerpt là đoạn OCR nguyên văn liên tục chứa toàn bộ câu và các phương án, gồm cả
nhãn câu nếu có. Không chép lại bằng lời khác. Câu tự luận có options={}.
Trả JSON {"questions":[{"id":"1","prompt":"...","options":{"A":"...","B":"..."},"review_reason":"","excerpt":"..."}]}.
Dữ liệu OCR của đề:
""" + dump(exam_pages),
        "Chưa tách được các câu có thể chấm riêng.",
    )
    drafts = by_id(reading.questions)
    if not drafts:
        return
    if len({choice_label(qid) for qid in drafts}) != len(drafts):
        raise ReviewRequired("Có số câu trùng trong bản chép đề.")
    questions = [
        Question.model_validate(q.model_dump() | {"max_points": q.max_points or Decimal(1)})
        for q in reading.questions
    ]
    calculated = {}
    exam_text = [normalized_option(text) for text in exam_pages]
    for question in questions:
        draft = drafts[question.id]
        draft.review_reason = draft.review_reason.strip()
        if draft.options:
            excerpt = normalized_option(draft.excerpt)
            has_options = all(
                re.search(rf"(?<!\w){letter.casefold()}(?:\s*[.):]\s*|\s+){re.escape(normalized_option(option))}(?!\w)", excerpt)
                for letter, option in draft.options.items()
            )
            if (
                not excerpt or not any(excerpt in text for text in exam_text)
                or normalized_option(draft.prompt) not in excerpt
                or not has_options
            ):
                draft.review_reason = draft.review_reason or "Chưa đối chiếu được đầy đủ câu hỏi và phương án với bản chép đề."
                continue
            if key := age_difference_key(question) or extreme_number_key(question):
                calculated[question.id] = key
                draft.review_reason = ""
    candidate_data = question_data([
        q for q in questions if q.options and q.id not in calculated and not drafts[q.id].review_reason
    ])
    solve_prompt = """Giải độc lập từng câu trắc nghiệm dưới đây. Kiểm tra từng phương án;
correct_options chứa toàn bộ phương án đúng, dù câu hỏi chỉ dự kiến chọn một.
Nếu dữ kiện không đủ hoặc OCR có thể nhầm chữ/số, đưa câu vào reviews và giải thích
phần cần đối chiếu. Tiếp tục những câu còn lại. Giữ nguyên số liệu của đề.
Trả JSON {"keys":[{"id":"1","correct_options":["A"],"solution":"Giải thích bằng tiếng Việt"}],
"reviews":[{"id":"2","reason":"Dữ kiện chưa rõ"}]}.
"""
    async def solve_independently(instruction: str) -> PartialKeyReading:
        try:
            return await read_json(PartialKeyReading, solve_prompt + instruction + "\n" + dump(candidate_data),
                                   "Chưa kiểm chứng được đáp án trắc nghiệm.")
        except ReviewRequired:
            return PartialKeyReading()

    first = second = PartialKeyReading()
    if candidate_data:
        first, second = await asyncio.gather(
            solve_independently("Giải bài toán rồi đối chiếu kết quả."),
            solve_independently("Thử lại từng phương án với điều kiện trong đề."),
        )
    first_keys = by_id(first.keys) | calculated
    second_keys = by_id(second.keys) | calculated
    issues = {item.id: item.reason for item in [*first.reviews, *second.reviews] if item.id not in calculated}
    choices_by_id = {}
    for mark in marks:
        choices_by_id.setdefault(choice_label(mark.label), []).append(mark)

    limiter = asyncio.Semaphore(4)
    answers, grades, reviews = [], [], []
    for question in questions:
        question_id = question.id
        reason = drafts[question_id].review_reason or issues.get(question_id)
        if not question.options:
            reason = reason or "Phần tự luận cần bản chép bài làm rõ để chấm."
        key, check = first_keys.get(question_id), second_keys.get(question_id)
        if not reason and (key is None or check is None):
            reason = "Chưa xác minh được đáp án từ các dữ kiện trên đề."
        if not reason and multiple_correct_options(question, key, check):
            reason = "Đề có nhiều phương án phù hợp trong khi câu chỉ yêu cầu một đáp án."
        if not reason and set(key.correct_options) != set(check.correct_options):
            reason = "Hai lượt kiểm tra chưa thống nhất về đáp án. Hãy đối chiếu lại đề."
        if not reason:
            key = key.model_copy(update={"rubric": []})
            try:
                key.validate_for(question)
            except ValueError:
                reason = "Đáp án chưa khớp với các phương án nhận diện từ đề."
        observed = choices_by_id.get(choice_label(question_id), [])
        if not reason and len(observed) != 1:
            reason = "Chưa xác định được một dấu chọn rõ cho câu này."
        if not reason:
            mark = observed[0]
            selected = set(mark.selected_options)
            if selected - question.options.keys() or not option_text_matches(mark, question) or not (
                bool(selected) and len(selected) == len(mark.selected_options)
                and (set(mark.option_text) == selected or (mark.letter_only and not mark.option_text))
            ):
                reason = "Chữ cái, nội dung cạnh dấu khoanh hoặc phương án trong đề chưa khớp."
        if reason:
            reviews.append(QuestionReview(id=question_id, reason=reason))
            continue
        evidence = ", ".join(
            f"{letter}. {mark.option_text[letter]}" if letter in mark.option_text else letter
            for letter in mark.selected_options
        )
        answer = RecognizedAnswer(id=question_id, status="answered", selected_options=mark.selected_options, evidence=evidence[:2000])
        answers.append(answer)
        grades.append(await grade_question(question, answer, key, "ai", limiter))

    analysis.questions = questions
    analysis.grades = grades
    analysis.answers = answers
    analysis.review_items = reviews
    analysis.total = analysis.max_total = None
    kinds = {bool(q.options) for q in questions}
    analysis.kind = "mixed" if len(kinds) > 1 else ("multiple_choice" if True in kinds else "written")
    if grades:
        analysis.reason = "AI đã chấm các câu đối chiếu được. Cần kiểm tra các mục bên dưới trước khi tính điểm cả bài."


async def grade_question(
    question: Question, answer: RecognizedAnswer, key: GradingKey, source: str, limiter: asyncio.Semaphore,
) -> QuestionGrade:
    criteria = []
    if answer.status == "blank":
        points, feedback, correction = Decimal(0), "Bạn bỏ trống câu này.", key.solution
    elif question.options:
        correct = set(answer.selected_options) == set(key.correct_options)
        points = question.max_points if correct else Decimal(0)
        feedback = "Bạn đã chọn đúng." if correct else "Lựa chọn của bạn không khớp đáp án."
        correction = key.solution
        if not correct and source == "official":
            try:
                async with limiter:
                    explanation = await read_json(
                        ChoiceFeedback,
                        """Giải thích ngắn vì sao lựa chọn của học sinh sai và cách kiểm tra lời giải.
Giữ nguyên đáp án chính thức. Nếu đề thiếu dữ kiện để giải thích hoặc nhận thấy mâu
thuẫn, đặt supported=false thay vì đặt giả thiết. Trả JSON
{"supported":true,"correction":"..."}; công thức dùng LaTeX.
Dữ liệu:
""" + dump({"question": question.model_dump(mode="json"), "official": key.model_dump(mode="json"),
                            "selected_options": answer.selected_options}),
                        "Chưa giải thích được đáp án chính thức.",
                    )
                if explanation.supported:
                    correction = explanation.correction
            except ReviewRequired:
                pass
    else:
        async with limiter:
            mark = await read_json(
                WrittenMark,
                """Chấm bài làm theo barem đã cho. Công nhận cách giải tương đương. Không dùng tổng điểm
từ bài làm và không tự sửa barem. Mỗi tiêu chí trả đúng index 1-based, điểm từ 0 đến
max_points, tối đa hai chữ số thập phân. Với điểm lớn hơn 0, quote phải là một đoạn
nguyên văn của bài làm làm bằng chứng. Công nhận một lời giải ngắn khi đã đáp ứng
đủ yêu cầu và barem. Giải thích tiêu chí mất điểm. correction
chỉ rõ cách sửa và bước tiếp theo bằng tiếng Việt, công thức dùng LaTeX. Nếu không đọc được lập luận cần
để cho điểm, readable=false. Trả JSON {"readable":true,"scores":[{"index":1,"points":0,
"quote":"","feedback":"..."}],"feedback":"...","correction":"..."}.
Dữ liệu:
""" + dump({"question": question.prompt, "key": key.model_dump(mode="json"), "answer": answer.text}),
                f"AI chưa chấm được đầy đủ tiêu chí của câu {question.id}.",
            )
        marks = {item.index: item for item in mark.scores}
        if not mark.readable or len(marks) != len(mark.scores) or marks.keys() != set(range(1, len(key.rubric) + 1)):
            raise ReviewRequired(f"AI chưa chấm được đầy đủ tiêu chí của câu {question.id}.")
        answer_evidence = normalized_quote(answer.text)
        for index, criterion in enumerate(key.rubric, 1):
            score = marks[index]
            quote = normalized_quote(score.quote)
            if score.points > criterion.max_points or (score.points and (not quote or quote not in answer_evidence)):
                raise ReviewRequired(f"Điểm hoặc trích dẫn câu {question.id} chưa khớp với barem và bài làm.")
            criteria.append(CriterionScore(
                label=criterion.label, points=score.points, max_points=criterion.max_points,
                quote=score.quote, feedback=score.feedback,
            ))
        points = sum((criterion.points for criterion in criteria), Decimal(0))
        feedback, correction = mark.feedback, mark.correction.strip() or key.solution
    return QuestionGrade(
        id=question.id, points=points, max_points=question.max_points, correct_options=key.correct_options,
        feedback=feedback, correction=correction, source=source, criteria=criteria,
    )


async def analyze_submission(
    pages: list[ExamPage], assignment: list[TeacherQuestion] | None = None,
    *, page_readings: list[PageReading] | None = None,
) -> AnalysisOut:
    analysis = AnalysisOut()
    limiter = asyncio.Semaphore(4)
    if assignment:
        analysis.questions = [Question.model_validate(item.model_dump()) for item in assignment]
        analysis.max_total = sum(q.max_points for q in analysis.questions)
    try:
        analysis.pages = page_readings if page_readings is not None else await read_pages(pages, limiter)
        if not transcripts(analysis, "answer") or (assignment is None and not transcripts(analysis, "exam")):
            raise ReviewRequired("Cần đủ đề thi và bài làm để chấm.")
        unreadable = next((page for page in analysis.pages if not page.readable), None)
        if unreadable:
            raise ReviewRequired(
                f"Chưa đọc được trang {unreadable.page} của {unreadable.file}. Hãy kiểm tra lại bản gốc hoặc thử lại."
            )
        if assignment is None:
            analysis.questions = await read_questions(analysis)
        kinds = {bool(q.options) for q in analysis.questions}
        analysis.kind = "mixed" if len(kinds) > 1 else ("multiple_choice" if True in kinds else "written")
        analysis.max_total = sum(q.max_points for q in analysis.questions)
        analysis.answers = await read_answers(analysis)
        keys = (
            {q.id: (q.grading_key(), "teacher") for q in assignment}
            if assignment else await build_keys(analysis)
        )
        marks = await asyncio.gather(*(
            grade_question(question, answer, *keys[question.id], limiter)
            for question, answer in zip(analysis.questions, analysis.answers)
        ), return_exceptions=True)
        for mark in marks:
            if isinstance(mark, BaseException):
                raise mark
        analysis.grades = marks
        analysis.total = sum(mark.points for mark in marks)
        analysis.state = "graded"
    except ReviewRequired as exc:
        analysis.reason = str(exc)
        if assignment is None:
            try:
                await grade_readable_choices(analysis)
            except ReviewRequired:
                pass
    except ValueError:
        analysis.reason = "Dữ liệu nhận diện, đáp án hoặc barem chưa hợp lệ để tính điểm."
    return analysis
