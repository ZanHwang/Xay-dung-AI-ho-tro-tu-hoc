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

- Python 3.11+
- PostgreSQL (có thể dùng Neon cloud, không cần cài local)
- Qdrant (cloud hoặc chạy local qua Docker)
- API key OpenAI và/hoặc Anthropic

## Cài đặt

```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # Windows
# source venv/bin/activate  # Linux/Mac

pip install -r requirements.txt
pip install -r requirements-dev.txt  # chỉ cần khi phát triển/chạy test

cp .env.example .env
# điền DATABASE_URL, SECRET_KEY, OPENAI_API_KEY, ... - xem .env.example để biết đủ biến
```

## Chạy

```bash
uvicorn app.main:app --reload
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

## Test

Nếu dùng database PostgreSQL đã tạo trước thay đổi ôn tập nhiều môn, chạy
`migrations/001_cross_subject_reviews.sql` một lần trước khi dùng tính năng này.
Database mới được tạo từ model đã hỗ trợ `quizzes.subject_id` để trống.

```bash
pytest
```
