import { useEffect, useState } from "react";
import { ChatImageView } from "./chat-image";
import { ChatDocument } from "./chat-document";
import type { ChatMessage as ChatMessageModel, MessageSource } from "@/features/tutor/types";
import { MarkdownContent } from "./markdown-content";
import { downloadDocumentFigure } from "@/features/subjects/services/document-api";

type ChatMessageProps = {
  message: ChatMessageModel;
  /**
   * When provided (reading workspace), a source's "(trang N)" part becomes a
   * clickable button that jumps the document viewer to that page. When
   * omitted the source line renders exactly as before (plain joined text).
   */
  onJumpToPage?: (page: number) => void;
};

// Load an auth-protected figure image (endpoint requires a bearer header, so an
// <img src> won't work) into an object URL for display in the source line.
function FigureThumb({ source }: { source: MessageSource }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source.figure || !source.document_id) return;
    let revoked = false;
    let objectUrl: string | null = null;
    downloadDocumentFigure(source.document_id, source.figure)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.figure, source.document_id]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`Hình trong ${source.document_name ?? "tài liệu"}`}
      loading="lazy"
      className="mt-1.5 max-h-40 rounded-md border border-border object-contain"
    />
  );
}

export function ChatMessage({ message, onJumpToPage }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "bubble bubble-user" : "bubble bubble-bot"}>
        {!!message.images?.length && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((image) => <ChatImageView key={image.id} image={image} />)}
          </div>
        )}

        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
        ) : (
          <MarkdownContent>{message.content}</MarkdownContent>
        )}

        {message.documents?.map((document) => <ChatDocument key={document.id} document={document} />)}

        {!isUser && (message.sources?.length || message.grounded === false || message.grounded === true) ? (
          <div className="bubble-src">
            {message.sources?.length ? (
              <>
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span>Nguồn:</span>
                  {message.sources.slice(0, 3).map((source, index) => (
                    <span key={source.chunk_id ?? index} className="mark-hl">
                      {source.document_name || "Tài liệu"}
                      {source.page ? (
                        onJumpToPage ? (
                          <>
                            ,{" "}
                            <button
                              type="button"
                              onClick={() => onJumpToPage(Number(source.page))}
                              className="jump-link"
                              aria-label={`Nhảy tới trang ${source.page}`}
                            >
                              trang {source.page}
                            </button>
                          </>
                        ) : (
                          <>, trang {source.page}</>
                        )
                      ) : null}
                    </span>
                  ))}
                  {message.sources.length > 3 ? <span>và {message.sources.length - 3} nguồn khác</span> : null}
                </p>
                {message.sources.slice(0, 3).filter((source) => source.figure && source.document_id).map((source) => (
                  <FigureThumb key={source.chunk_id ?? source.figure} source={source} />
                ))}
              </>
            ) : message.grounded ? (
              <p>Đã tìm trong tài liệu nhưng không thấy nội dung phù hợp với câu hỏi.</p>
            ) : (
              <p>Trả lời từ tri thức chung, không dùng tài liệu</p>
            )}
          </div>
        ) : null}

        <p className="bubble-ts mt-1 text-xs">{message.timestamp}</p>
      </div>
    </div>
  );
}
