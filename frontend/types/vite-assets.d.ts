// Ambient declarations for Vite asset imports (this project runs on vinext's
// Vite pipeline, not the Next.js asset pipeline, and tsconfig does not include
// vite/client in its `types`). The `?url` suffix returns the public URL of the
// emitted asset — used to point the pdf.js worker at the bundled worker file.
//
// This file is required by `features/reading/components/pdf-viewer.tsx` line 27
// (`import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"`).
// Without it, `tsc --noEmit` reports TS2307 for that import.
declare module "*?url" {
  const url: string;
  export default url;
}
