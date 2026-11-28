import { httpClient } from "@/services/http-client";
import type { ChatImage } from "../types";
import { MAX_IMAGE_BYTES, removeChatImages, validateChatImages } from "./chat-images";

// PDF only - document attachments are uploaded + indexed through the same
// backend pipeline as subject documents (see document-api.ts), which only
// accepts PDF; anything else used to be silently dropped from the answer.
export const DOCUMENT_ACCEPT = ".pdf";
const extensions = new Set(DOCUMENT_ACCEPT.split(","));
export function validateChatAttachments(files: File[]) {
  if (files.length > 4) throw new Error("Mỗi tin nhắn tối đa 4 tệp (ảnh hoặc tài liệu).");
  validateChatImages(files.filter((file) => file.type.startsWith("image/")));
  for (const file of files) {
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(`Tệp “${file.name}” phải có dung lượng từ 1 byte đến 10 MB.`);
    if (!file.type.startsWith("image/") && !extensions.has(file.name.slice(file.name.lastIndexOf(".")).toLowerCase())) {
      throw new Error("Chọn ảnh JPG/PNG/WebP hoặc tài liệu PDF (Word/PowerPoint hãy xuất sang PDF trước).");
    }
  }
}

export async function saveChatAttachments(files: File[]) {
  validateChatAttachments(files);
  if (!files.length) return [];
  for (const file of files.filter((item) => item.type.startsWith("image/"))) {
    try { const bitmap = await createImageBitmap(file); bitmap.close(); }
    catch { throw new Error(`Không đọc được ảnh “${file.name}”. Hãy chọn ảnh hợp lệ.`); }
  }
  // Upload to the server (shared storage) so the conversation shows these on
  // every device. If one upload fails, drop the ones already stored.
  const saved: ChatImage[] = [];
  try {
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      saved.push(await httpClient.post<ChatImage>("/conversations/attachments", body));
    }
  } catch (error) {
    await removeChatImages(saved).catch(() => undefined);
    throw error;
  }
  return saved;
}
