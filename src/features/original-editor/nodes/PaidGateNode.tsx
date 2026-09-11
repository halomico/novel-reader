"use client";

import type { JSX } from "react";
import { LockKeyhole } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useBlockSelection } from "./block-selection";
import styles from "../OriginalComposer.module.css";

export type SerializedPaidGateNode = Spread<
  { type: "paid-gate"; version: 1 },
  SerializedLexicalNode
>;

export class PaidGateNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return "paid-gate";
  }

  static clone(node: PaidGateNode): PaidGateNode {
    return new PaidGateNode(node.__key);
  }

  static importJSON(): PaidGateNode {
    return $createPaidGateNode();
  }

  exportJSON(): SerializedPaidGateNode {
    return { ...super.exportJSON(), type: "paid-gate", version: 1 };
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.className = config.theme.paidGate || "";
    element.setAttribute("data-original-paid-gate", "true");
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <PaidGateMarker nodeKey={this.__key} />;
  }
}

/**
 * The boundary is a thin labelled rule in the flow of the text, not a card: the prose
 * stays the thing the eye lands on. One click selects it (Backspace removes it, the
 * arrow keys step over it); the remove button does the same in one step and puts the
 * caret back into the text, so it is a single undoable edit on a touch screen too.
 */
function PaidGateMarker({ nodeKey }: { nodeKey: NodeKey }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [selected, ref] = useBlockSelection<HTMLDivElement>(nodeKey);
  return (
    <div
      ref={ref}
      className={`${styles.paidGateMarker}${selected ? ` ${styles.blockSelected}` : ""}`}
      contentEditable={false}
      role="separator"
      aria-label="付费分界"
    >
      <span className={styles.paidGateLabel}>
        <LockKeyhole size={14} aria-hidden="true" />以下内容需付费解锁
      </span>
      <button
        type="button"
        className={styles.paidGateRemove}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if (!node) return;
            const previous = node.getPreviousSibling();
            const next = node.getNextSibling();
            node.remove();
            if ($isElementNode(previous)) previous.selectEnd();
            else if ($isElementNode(next)) next.selectStart();
            else {
              const paragraph = $createParagraphNode();
              if (next) next.insertBefore(paragraph); else if (previous) previous.insertAfter(paragraph);
              paragraph.select();
            }
          });
          editor.focus();
        }}
      >
        移除
      </button>
    </div>
  );
}

export function $createPaidGateNode(): PaidGateNode {
  return $applyNodeReplacement(new PaidGateNode());
}

export function $isPaidGateNode(node: LexicalNode | null | undefined): node is PaidGateNode {
  return node instanceof PaidGateNode;
}
