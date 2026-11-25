// Ambient declaration for the pdf.js worker module (no .d.mts ships next to
// the minified worker). Only the main-thread entry point is needed: when
// `globalThis.pdfjsWorker` exposes it, pdf.js runs the worker on the main
// thread instead of spawning a dedicated Web Worker.
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
