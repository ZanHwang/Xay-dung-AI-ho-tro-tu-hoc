import { useCallback } from "react";

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
 * The element needs `tabIndex={-1}`.
 */
export function useModalLayer() {
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
    return () => {
      for (const element of hidden) element.inert = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
}
