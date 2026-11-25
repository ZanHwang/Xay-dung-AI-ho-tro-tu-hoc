export type DocumentPreview =
  | { kind: "pdf" | "image"; blob: Blob }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "unsupported" };

const TEXT_LIMIT = 2 * 1024 * 1024;
const imageTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
};
const textExtensions = new Set(["txt", "md", "csv", "json", "ipynb", "log", "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "css", "html", "xml", "svg", "yaml", "yml", "sql"]);

/**
 * Inspect the first few bytes of a blob to determine if it is a PDF.
 * Real PDFs always start with the bytes `%PDF-` (0x25 0x50 0x44 0x46 0x2D).
 * Some browsers will refuse to render a file that claims to be PDF via MIME
 * type or extension but does not start with these bytes, throwing
 * "Failed to load PDF document." Detecting via magic bytes lets us fall back
 * to a text or "unsupported" preview instead.
 */
async function isPdfBlob(blob: Blob): Promise<boolean> {
  try {
    const header = await blob.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(header);
    return (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    );
  } catch {
    return false;
  }
}

export async function prepareDocumentPreview(name: string, blob: Blob): Promise<DocumentPreview> {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = blob.type.toLowerCase().split(";")[0];
  if (extension === "pdf" || mime === "application/pdf") {
    if (await isPdfBlob(blob)) {
      return { kind: "pdf", blob: blob.slice(0, blob.size, "application/pdf") };
    }
    // File claims to be PDF (by extension or MIME) but the magic bytes say
    // otherwise. Don't hand it to the PDF viewer - it will fail to load.
    // Fall through and try to render as text below, otherwise mark unsupported.
  }
  const imageType = imageTypes[extension] ?? Object.values(imageTypes).find((type) => type === mime);
  if (imageType) return { kind: "image", blob: blob.slice(0, blob.size, imageType) };
  if (textExtensions.has(extension) || mime.startsWith("text/") || mime === "application/json") {
    return { kind: "text", text: await blob.slice(0, TEXT_LIMIT).text(), truncated: blob.size > TEXT_LIMIT };
  }
  return { kind: "unsupported" };
}

export function downloadDocument(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
