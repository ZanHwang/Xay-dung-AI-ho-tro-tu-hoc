# TuHoc (JARVIS) — AI hỗ trợ học tập cá nhân hoá

Web học tập cá nhân hoá: AI Tutor hỏi đáp theo tài liệu (RAG), quản lý tài
liệu, Lộ trình học theo chủ đề, Quiz, chấm Tự luận theo barem, Lớp học.

## Cấu trúc

```
.
├── backend/   # FastAPI + PostgreSQL (Neon) + Qdrant - xem backend/README.md
└── frontend/  # React/Next.js (Vinext) trên Cloudflare Workers - xem frontend/README.md
```

## Chạy nhanh

```bash
# Backend (cổng 8000)
cd backend && venv\Scripts\activate && uvicorn app.main:app --reload

# Frontend (terminal khác)
cd frontend && pnpm dev
```

Chi tiết cài đặt/biến môi trường/tính năng: xem README trong từng thư mục.
