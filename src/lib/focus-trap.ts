import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter((element) => {
    // Must be visible and interactable
    if (typeof element.hasAttribute === "function" && element.hasAttribute("disabled")) return false;
    if (typeof element.getAttribute === "function" && element.getAttribute("aria-hidden") === "true") return false;
    if (element.style && (element.style.display === "none" || element.style.visibility === "hidden")) return false;
    if (
      typeof element.getClientRects === "function" &&
      element.getClientRects().length === 0 &&
      element.offsetWidth === 0 &&
      element.offsetHeight === 0
    ) {
      return false;
    }
    const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(element) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  });
}

export function trapTabKey(event: KeyboardEvent, container: HTMLElement | null): boolean {
  if (event.key !== "Tab" || !container) return false;
  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    return true;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

  if (event.shiftKey) {
    // Shift + Tab: reverse cycling
    if (!active || active === first || !container.contains(active)) {
      event.preventDefault();
      last?.focus();
      return true;
    }
  } else {
    // Tab: forward cycling
    if (!active || active === last || !container.contains(active)) {
      event.preventDefault();
      first?.focus();
      return true;
    }
  }
  return false;
}

export type UseFocusTrapOptions = {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocus?: boolean;
  onEscape?: () => void;
  closeOnBackdrop?: boolean;
};

/**
 * Traps Tab focus inside `containerRef` when `active` is true.
 * Restores focus to the previously active element on close.
 * Handles ESC key and optional backdrop dismissal.
 */
export function useFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  returnFocus = true,
  onEscape,
  closeOnBackdrop = true,
}: UseFocusTrapOptions): void {
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (!active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        if (returnFocus && previousActiveElementRef.current) {
          const toFocus = previousActiveElementRef.current;
          previousActiveElementRef.current = null;
          requestAnimationFrame(() => {
            if (typeof toFocus.focus === "function") {
              toFocus.focus();
            }
          });
        }
      }
      return;
    }

    if (!wasActiveRef.current) {
      wasActiveRef.current = true;
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        previousActiveElementRef.current = document.activeElement;
      }
    }

    const container = containerRef.current;
    if (!container) return;

    // 2. Set initial focus after DOM render
    const frame = requestAnimationFrame(() => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      const targetFocus = initialFocusRefRef.current?.current;
      if (targetFocus) {
        targetFocus.focus();
      } else {
        const focusables = getFocusableElements(currentContainer);
        const autoFocusElement = currentContainer.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
        if (autoFocusElement && focusables.includes(autoFocusElement)) {
          autoFocusElement.focus();
        } else if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          currentContainer.focus?.();
        }
      }
    });

    // 3. Tab key trap & Escape listener
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }
      if (event.key === "Tab") {
        trapTabKey(event, containerRef.current);
      }
    }

    // 4. Backdrop click handler for native <dialog>
    function handleClick(event: MouseEvent) {
      if (!closeOnBackdrop || !onEscapeRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target && target === containerRef.current && target.tagName === "DIALOG") {
        const rect = target.getBoundingClientRect();
        const isInDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInDialog) {
          onEscapeRef.current();
        }
      }
    }

    const targetElement = container;
    targetElement.addEventListener("keydown", handleKeyDown);
    if (closeOnBackdrop) {
      targetElement.addEventListener("click", handleClick);
    }

    return () => {
      cancelAnimationFrame(frame);
      targetElement.removeEventListener("keydown", handleKeyDown);
      if (closeOnBackdrop) {
        targetElement.removeEventListener("click", handleClick);
      }
    };
  }, [active, closeOnBackdrop, containerRef, returnFocus]);

  // Restore focus on unmount if still active
  useEffect(() => {
    return () => {
      if (returnFocus && previousActiveElementRef.current) {
        const toFocus = previousActiveElementRef.current;
        requestAnimationFrame(() => {
          if (typeof toFocus.focus === "function") {
            toFocus.focus();
          }
        });
      }
    };
  }, [returnFocus]);
}
