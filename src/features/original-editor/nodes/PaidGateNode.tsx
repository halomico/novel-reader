"use client";

import type { JSX } from "react";
import {
  $applyNodeReplacement,
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
    return (
      <div className={styles.paidGateCard} contentEditable={false}>
        <span aria-hidden="true" />
        <strong>公开内容到此结束</strong>
        <small>以下内容仅在读者解锁后显示</small>
      </div>
    );
  }
}

export function $createPaidGateNode(): PaidGateNode {
  return $applyNodeReplacement(new PaidGateNode());
}

export function $isPaidGateNode(node: LexicalNode | null | undefined): node is PaidGateNode {
  return node instanceof PaidGateNode;
}
