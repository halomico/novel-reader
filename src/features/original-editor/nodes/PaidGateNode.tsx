"use client";

import type { JSX } from "react";
import { LockKeyhole, Trash2 } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $isElementNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
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
    return <PaidGateCard nodeKey={this.__key} />;
  }
}

/**
 * The boundary is a block the writer can see and act on, not an invisible marker.
 * Removing it here goes through the editor so it is a single undoable step, and the
 * caret is put back in the document rather than left inside a decorator.
 */
function PaidGateCard({ nodeKey }: { nodeKey: NodeKey }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  return (
    <div className={styles.paidGateCard} contentEditable={false}>
      <LockKeyhole size={17} aria-hidden="true" />
      <strong>公开内容到此结束</strong>
      <small>以下内容仅在读者解锁后显示</small>
      <button
        type="button"
        className={styles.paidGateRemove}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            const focus = node?.getNextSibling() || node?.getPreviousSibling();
            node?.remove();
            if ($isElementNode(focus)) focus.selectStart();
          });
          editor.focus();
        }}
      >
        <Trash2 size={13} aria-hidden="true" />移除分界
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
