# AI Tutor Backend

AI Gia Sư Hỗ Trợ Học Tập Tiếng Việt - Backend API

## Tính năng

- **AI Tutor**: chat hỏi đáp theo tài liệu đã tải lên (RAG), nhận diện ảnh/hình minh họa
- **Quản lý tài liệu**: upload PDF/Word, tự OCR, tách hình/biểu đồ, đọc kiểu immersive
- **Lộ trình học**: chia chủ đề theo từng tài liệu, mở khóa tuần tự
- **Quiz**: ngân hàng câu hỏi dùng chung + AI sinh thêm, chấm điểm, ôn tập theo lịch (spaced-repetition)
- **Tự luận**: chấm theo barem, chấm hàng loạt cho giáo viên
- **Lớp học**: tạo lớp bằng mã mời, giáo viên chấm bài học sinh

## Công nghệ

- **Framework:** FastAPI (Python)
- **Database:** PostgreSQL (dùng Neon) + SQLAlchemy
- **Vector DB:** Qdrant
- **AI:** OpenAI / Anthropic LLM, RAG Pipeline

## Yêu cầu hệ thống

- Python 3.12 được khuyến nghị cho các phiên bản thư viện đang dùng.
- PostgreSQL (có thể dùng Neon cloud, không cần cài local)
- Qdrant (cloud hoặc chạy local qua Docker)
- API key OpenAI và/hoặc Anthropic

## Cài đặt

Cài đặt trên Windows bằng PowerShell. Lệnh tạo môi trường chỉ chạy khi chưa có `venv`.

```powershell
cd backend
if (-not (Test-Path -LiteralPath 'venv/Scripts/python.exe')) {
    py -3.12 -m venv venv
}

.\venv\Scripts\python.exe -m pip install -r requirements.txt
# Chỉ cần khi phát triển hoặc chạy kiểm thử
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền các biến cần thiết theo `.env.example`. Trên macOS hoặc Linux, dùng `python3.12 -m venv venv` khi cài lần đầu và dùng `venv/bin/python` để chạy các lệnh.

## Chạy

```powershell
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Server chạy tại: http://localhost:8000

Toàn bộ API (đầy đủ, luôn khớp code vì tự sinh): http://localhost:8000/docs (Swagger UI) hoặc /redoc

## Cấu trúc thư mục

```
backend/
├── app/
│   ├── main.py      # Entry point
│   ├── config.py    # Cấu hình (đọc từ .env)
│   ├── database.py  # Kết nối DB
│   ├── models/       # SQLAlchemy models
│   ├── schemas/      # Pydantic schemas
│   ├── routers/      # API routes - 1 file/nhóm: auth, subjects, path,
│   │                 #   conversations, documents, reading, quizzes,
│   │                 #   progress, essays, classes
│   ├── services/     # Business logic tương ứng từng router
│   ├── ai/           # LLM, RAG, vision, figures
│   └── utils/
├── tests/
└── .env.example
```

## Chấm bài thi từ ảnh và PDF

Trên máy Windows đã cài TuHoc, mở `Run-TuHoc-Local.cmd` trong thư mục `DOAN` để chạy ở cổng 3000. Bản này tạo các bảng chấm bài trên PostgreSQL cục bộ, dùng tài khoản và lịch sử của máy.

- **Chấm bài** trong workspace cho phép nộp đề và bài làm, kèm đáp án hoặc barem chính thức nếu có. Lịch sử chỉ hiển thị cho chủ bài nộp.
- **Lớp học** dùng đề và barem do giáo viên của lớp giao. Học sinh nộp một bài cho mỗi đề. Giáo viên có thể đối chiếu tệp gốc với nội dung nhận diện, chấm lại và chốt điểm theo từng câu.
- Tệp PDF, PNG và JPEG được giới hạn 8 MB mỗi tệp, tổng 24 MB và 12 trang hoặc ảnh cho mỗi lần nộp. Bài thi có tối đa 50 câu. Backend đọc trực tiếp PDF có chữ và dùng OCR cho trang cần xem ảnh. Trường hợp đề không in điểm, backend chia thang 10 cho các câu. Bài thiếu dữ kiện hoặc chưa đọc chắc chắn sẽ ở trạng thái cần kiểm tra.

Các bảng chấm bài thi được cài riêng. Sau khi xác nhận cơ sở dữ liệu đích, đặt biến môi trường `EXAM_SCHEMA_DATABASE_URL` trỏ tới cơ sở dữ liệu PostgreSQL đã được phê duyệt. Chạy từ thư mục `backend` bằng Python của môi trường ảo

```powershell
.\venv\Scripts\python.exe -m app.install_exam_schema
```

Backend đọc khóa OpenAI và model vision từ cấu hình hiện có. Kiểm thử luồng chấm bài dùng phản hồi AI mô phỏng và một cơ sở dữ liệu riêng.

## Test

```bash
pytest
```
