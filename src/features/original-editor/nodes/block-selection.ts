"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { CLICK_COMMAND, COMMAND_PRIORITY_LOW, type NodeKey } from "lexical";

/**
 * A non-text block (paid boundary, scene break, image) is selected as a whole by one
 * click, exactly like a picture in a word processor. The selection is what makes it
 * reachable: Backspace/Delete remove it, Enter opens a paragraph after it, and the
 * arrow keys step off it.
 *
 * The click is taken through CLICK_COMMAND ahead of the rich-text handler rather than
 * a React `onClick`. Decorators render through portals, and React listens on portal
 * containers, so a React handler ran *before* Lexical's own click handling — which
 * then saw a node selection and cleared it again, leaving the caret nowhere.
 */
export function useBlockSelection<T extends HTMLElement>(nodeKey: NodeKey): [boolean, RefObject<T | null>] {
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const ref = useRef<T>(null);

  useEffect(() => editor.registerCommand(CLICK_COMMAND, (event) => {
    const element = ref.current;
    const target = event.target;
    if (!element || !editor.isEditable() || !(target instanceof Element) || !element.contains(target)) return false;
    // Controls inside the block (the paid boundary's remove button) act on their own.
    if (target.closest("button")) return false;
    event.preventDefault();
    clearSelection();
    setSelected(true);
    const root = editor.getRootElement();
    if (root && document.activeElement !== root) root.focus({ preventScroll: true });
    return true;
  }, COMMAND_PRIORITY_LOW), [clearSelection, editor, setSelected]);

  return [selected, ref];
}
