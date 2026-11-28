"use client";

import { useEffect } from "react";

// Alegreya Sans (whole UI) + Patrick Hand (notebook labels and red-pen scores),
// both with the Vietnamese subset. Injected into <head> on mount so the rest of
// the app (server-rendered markup, Next routes) is untouched. Fails open if
// blocked — the CSS falls back to system-ui.
const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@400;500;700;800&family=Patrick+Hand&display=swap";

export function FontLoader() {
  useEffect(() => {
    if (document.getElementById("jarvis-v2-fonts")) return;

    const preconnects: Array<{ rel: string; href: string; crossorigin?: string }> = [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    ];
    for (const attrs of preconnects) {
      const link = document.createElement("link");
      link.rel = attrs.rel;
      link.href = attrs.href;
      if (attrs.crossorigin) link.crossOrigin = "";
      document.head.appendChild(link);
    }

    const link = document.createElement("link");
    link.id = "jarvis-v2-fonts";
    link.rel = "stylesheet";
    link.href = FONT_STYLESHEET;
    document.head.appendChild(link);
  }, []);

  return null;
}
