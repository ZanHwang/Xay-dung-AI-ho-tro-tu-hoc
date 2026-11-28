import { useCallback, useEffect, useRef } from "react";

/** Mounted layers, the one opened last (on top) at the end. */
const layers: HTMLElement[] = [];

/**
 * Ref for a layer that covers the page (quiz, lesson, reading view). While the
 * layer is mounted everything it hides is `inert`, so Tab and clicks cannot
 * reach it; focus moves into the layer and returns to the opener afterwards.
 *
 * The layer hides its siblings and its ancestors' siblings, stopping at the
 * closest `data-layer-root` - the area it is confined to - so a sidebar that
 * stays visible beside it also stays usable. Without such an ancestor the layer
 * covers the whole window and everything else is hidden.
 *
 * Escape calls `onClose` for the top layer only, and not when a dialog or menu
 * above it has already used the key.
 *
 * The element needs `tabIndex={-1}`.
 */
export function useModalLayer(onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  return useCallback((layer: HTMLElement | null) => {
    if (!layer) return;
    const opener = document.activeElement as HTMLElement | null;
    const hidden: HTMLElement[] = [];
    for (
      let node = layer;
      node !== document.body && node.parentElement && !node.hasAttribute("data-layer-root");
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          hidden.push(sibling);
        }
      }
    }
    layer.focus({ preventScroll: true });
    layers.push(layer);
    const onKey = (event: KeyboardEvent) => {
      // Radix dialogs and menus mark the event when Escape dismisses them.
      if (event.key !== "Escape" || event.defaultPrevented || layers.at(-1) !== layer) return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      layers.splice(layers.indexOf(layer), 1);
      for (const element of hidden) element.inert = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
}
