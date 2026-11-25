"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider attribute="class" storageKey="jarvis.theme" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemeProvider>
  );
}
