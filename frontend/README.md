# JARVIS / TuHoc — Frontend

Frontend cho dự án học tập cá nhân hoá TuHoc (JARVIS). Kết nối trực tiếp với
backend thật (FastAPI) — không còn là bản demo/mock.

## Tính năng

- **AI Tutor**: chat hỏi đáp theo tài liệu đã tải lên (RAG), đính kèm ảnh/tài liệu, nhập giọng nói
- **Môn học**: tạo môn, quản lý tài liệu (upload/xem trước/tải xuống), đọc tài liệu kiểu immersive
- **Lộ trình**: chủ đề theo từng tài liệu, mở khóa tuần tự, xem nội dung "Học" + luyện tập
- **Quiz**: tạo quiz theo môn/chủ đề, làm bài, xem giải thích, ôn lại câu đến hạn (spaced-repetition)
- **Tự luận**: nộp bài, chấm theo barem
- **Lớp học**: vào lớp bằng mã, giáo viên tạo lớp + chấm hàng loạt
- **Tổng quan (Dashboard)**: số liệu môn/quiz, câu đến hạn ôn, quiz/chat gần đây

## Công nghệ

- React 19, TypeScript, Vinext (App Router kiểu Next.js) trên Vite
- Tailwind CSS 4, shadcn/ui, Radix UI
- Chạy trên Cloudflare Workers runtime (wrangler)

## Yêu cầu hệ thống

- Node.js 22.13.0+
- pnpm 11.25.0 (khai báo sẵn trong `package.json`)
- Backend chạy sẵn (xem `backend/README.md`), hoặc chỉnh `NEXT_PUBLIC_API_BASE_URL`
  trỏ tới backend đang chạy

## Cài đặt

```bash
cd frontend
pnpm install

cp .env.example .env
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api (mặc định, đổi nếu backend chạy nơi khác)
```

## Chạy

```bash
pnpm dev
```

## Cấu trúc thư mục

```
frontend/
├── app/              # Route (App Router kiểu Next.js)
├── features/         # 1 thư mục / tính năng: auth, dashboard, tutor,
│                      #   subjects, quiz, path, reading, essay, classes,
│                      #   reviews, settings, workspace, landing
├── components/        # UI dùng chung (shadcn/ui + layout)
├── services/           # HTTP client gọi backend
├── hooks/, types/      # Dùng chung
└── .env.example
```
