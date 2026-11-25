import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/components/theme-provider";
import { FontLoader } from "@/components/font-loader";

export const metadata: Metadata = {
  title: "TuHoc — Học từ tài liệu của bạn",
  description:
    "Tạo môn học, đẩy tài liệu, hỏi đáp trực tiếp trên tài liệu, làm quiz và chấm tự luận theo barem.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="antialiased">
        <FontLoader />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
