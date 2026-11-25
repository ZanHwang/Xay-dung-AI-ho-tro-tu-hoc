"use client";

/**
 * Single-page PDF viewer built on pdfjs-dist.
 *
 * The parent owns `currentPage` (so a clicked citation can jump the viewer);
 * zoom is internal. Highlights are matched against the rendered pdf.js
 * text layer of the current page; a highlight that can't be found (e.g. an
 * OCR'd or figure page) is silently skipped here and instead shown in the
 * notes panel - it must never break the render.
 *
 * IMPORTANT: pdfjs-dist is loaded via DYNAMIC IMPORT inside the mount effect,
 * not at module scope. The library's module-scope code touches `window`
 * (to detect the host environment), which makes a static import blow up
 * during SSR and during Vite's module-evaluation pass in dev. Dynamic
 * import defers the evaluation until after mount, when `window` is guaranteed
 * to exist - this is what makes the "UNHANDLED SCRIPT ERROR: window is not
 * defined" banner on first open go away.
 */
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

// Load the LEGACY build at runtime: the modern build crashes on SSR
// (module-level `new DOMMatrix()`), so the legacy build is imported
// dynamically after mount, where browser globals are available.
type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** The runtime shape of a TextLayer instance that `applyHighlights` needs. */
type TextLayerLike = {
  textContentItemsStr: string[];
  textDivs: (HTMLDivElement | undefined)[];
};

// Wrap any `texts` found in a rendered text layer's items with a <mark>.
function applyHighlights(layer: TextLayerLike, texts: string[]) {
  if (texts.length === 0) return;
  const wants = texts.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 4);
  if (wants.length === 0) return;
  const remaining = [...wants];
  layer.textContentItemsStr.forEach((item, index) => {
    const haystack = item.toLowerCase();
    const hit = remaining.find((w) => haystack.includes(w));
    if (hit === undefined) return;
    const div = layer.textDivs[index];
    if (!div) return;
    const mark = document.createElement("mark");
    mark.className = "hl";
    div.replaceWith(mark);
    mark.appendChild(div);
    remaining.splice(remaining.indexOf(hit), 1);
  });
}

type PdfViewerProps = {
  data: ArrayBuffer;
  currentPage: number;
  onPageChange: (page: number) => void;
  /** Annotation text to <mark>-wrap on the current page's text layer. */
  highlightTexts?: string[];
  onReady?: (numPages: number) => void;
};

export function PdfViewer({
  data,
  currentPage,
  onPageChange,
  highlightTexts = [],
  onReady,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Page input shows the live page when unfocused; a local buffer while the
  // user is typing so we don't clash with an external jump (e.g. citation).
  const [focused, setFocused] = useState(false);
  const [buffer, setBuffer] = useState("");
  const pageValue = focused ? buffer : String(currentPage);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const textLayerInstanceRef = useRef<unknown | null>(null);
  const pdfjsPromise = useRef<Promise<PdfjsModule> | null>(null);

  /** Lazy-load pdf.js once, only on the client (window is guaranteed here). */
  function loadPdfjs(): Promise<PdfjsModule> {
    if (!pdfjsPromise.current) {
      pdfjsPromise.current = Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
      ])
        .then(([pdfjs, pdfjsWorker]) => {
          // pdf.js checks globalThis.pdfjsWorker?.WorkerMessageHandler and,
          // when present, runs the worker on the MAIN THREAD ("fake worker")
          // instead of `new Worker(...)`. We need this in dev because the
          // dedicated module worker crashes: Vite serves the worker file with
          // an injected `/@vite/client` import, and that client references
          // `window` at module scope - undefined in a worker realm.
          // Importing the worker module sets globalThis.pdfjsWorker itself
          // (its own side effect); `??=` just makes it explicit.
          (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= pdfjsWorker;
          return pdfjs;
        })
        .catch((err) => {
          pdfjsPromise.current = null; // allow a retry on next mount
          throw err;
        });
    }
    return pdfjsPromise.current;
  }

  // Load the document once per buffer.
  useEffect(() => {
    let cancelled = false;
    loadPdfjs()
      .then((pdfjs) => {
        if (cancelled) return;
        const task = pdfjs.getDocument({ data });
        task.promise
          .then((doc) => {
            if (cancelled) {
              doc.destroy();
              return;
            }
            pdfRef.current = doc;
            setNumPages(doc.numPages);
            onReady?.(doc.numPages);
          })
          .catch(() => {
            if (!cancelled) setRenderError("Không mở được tệp PDF.");
          });
      })
      .catch(() => {
        if (!cancelled) setRenderError("Không tải được trình đọc PDF.");
      });
    return () => {
      cancelled = true;
      (textLayerInstanceRef.current as { cancel?: () => void } | null)?.cancel?.();
      renderTaskRef.current?.cancel();
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Render current page + text layer + highlights.
  useEffect(() => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    if (!doc || !canvas || !textLayerDiv || numPages === 0) return;

    let cancelled = false;

    const doRender = async () => {
      const page = await doc.getPage(currentPage);
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.getContext("2d")?.scale(dpr, dpr);

      renderTaskRef.current?.cancel();
      renderTaskRef.current = page.render({ canvas, viewport });
      await renderTaskRef.current.promise;

      // Fresh text layer for this page (TextLayer cannot be reused across pages).
      // The layer div must match the canvas box exactly, or its positioned
      // text items drift and show as stray glyphs above/around the page.
      (textLayerInstanceRef.current as { cancel?: () => void } | null)?.cancel?.();
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
      textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;

      const pdfjs = await loadPdfjs();
      const textContent = await page.getTextContent();
      const layer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      }) as unknown as TextLayerLike & { render: () => Promise<void>; cancel?: () => void };
      textLayerInstanceRef.current = layer;
      await layer.render();

      if (cancelled) return;
      applyHighlights(layer, highlightTexts);
    };

    doRender().catch(() => {
      /* A cancelled render (rapid page/zoom change) is expected - ignore it. */
    });

    return () => {
      cancelled = true;
    };
  }, [currentPage, scale, numPages, highlightTexts]);

  function clampPage(n: number) {
    const max = numPages || 1;
    return Math.max(1, Math.min(max, n));
  }

  function goTo(n: number) {
    onPageChange(clampPage(n));
  }

  function commitPageInput() {
    const n = parseInt(buffer, 10);
    if (Number.isFinite(n)) goTo(n);
    setFocused(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
            className="grid size-8 place-items-center rounded-md border border-border disabled:opacity-40"
            aria-label="Trang trước"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex items-center gap-1 text-sm">
            <input
              className="w-12 rounded-md border border-border bg-background px-1.5 py-0.5 text-center text-sm"
              value={pageValue}
              onFocus={() => {
                setBuffer(String(currentPage));
                setFocused(true);
              }}
              onChange={(e) => setBuffer(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageInput();
              }}
              aria-label="Trang hiện tại"
            />
            <span className="text-muted-foreground">/ {numPages || "…"}</span>
          </div>
          <button
            type="button"
            onClick={() => goTo(currentPage + 1)}
            disabled={numPages > 0 && currentPage >= numPages}
            className="grid size-8 place-items-center rounded-md border border-border disabled:opacity-40"
            aria-label="Trang sau"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="grid size-8 place-items-center rounded-md border border-border"
            aria-label="Thu nhỏ"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            className="grid size-8 place-items-center rounded-md border border-border"
            aria-label="Phóng to"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>

      {/* Page canvas */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        {renderError ? (
          <p className="text-sm text-destructive">{renderError}</p>
        ) : (
          <div className="relative mx-auto" style={{ width: "fit-content" }}>
            <div ref={textLayerRef} className="absolute inset-0 z-0 overflow-hidden" />
            <canvas ref={canvasRef} className="relative z-10 rounded-md shadow" />
          </div>
        )}
      </div>
    </div>
  );
}
