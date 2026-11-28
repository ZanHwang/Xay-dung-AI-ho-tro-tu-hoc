import { httpClient } from "@/services/http-client";
import type { ChatImage } from "../types";

export const MAX_CHAT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateChatImages(files: File[]) {
  if (files.length > MAX_CHAT_IMAGES) throw new Error("Mỗi tin nhắn tối đa 4 ảnh.");
  for (const file of files) {
    if (!allowed.has(file.type)) throw new Error(`Ảnh “${file.name}” cần có định dạng JPG, PNG hoặc WebP.`);
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(`Ảnh “${file.name}” phải có dung lượng từ 1 byte đến 10 MB.`);
  }
}

// Attachments live on the server (shared storage), so a conversation shows
// them on every device. Cached per page load: re-renders don't refetch.
const blobs = new Map<string, Promise<Blob | null>>();

export function loadChatImage(id: string): Promise<Blob | null> {
  let pending = blobs.get(id);
  if (!pending) {
    pending = httpClient.getBlob(`/conversations/attachments/${encodeURIComponent(id)}`).catch(() => {
      blobs.delete(id);
      return null;
    });
    blobs.set(id, pending);
  }
  return pending;
}

/** Delete attachments uploaded for a message that was never sent. (Deleting
 * a conversation removes its attachments server-side by itself.) */
export async function removeChatImages(images: ChatImage[]) {
  await Promise.all(images.map(async (image) => {
    blobs.delete(image.id);
    await httpClient.delete(`/conversations/attachments/${encodeURIComponent(image.id)}`);
  }));
}
