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

export type SerializedDividerNode = Spread<
  { type: "original-divider"; version: 1 },
  SerializedLexicalNode
>;

export class DividerNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return "original-divider";
  }

  static clone(node: DividerNode): DividerNode {
    return new DividerNode(node.__key);
  }

  static importJSON(): DividerNode {
    return $createDividerNode();
  }

  exportJSON(): SerializedDividerNode {
    return { ...super.exportJSON(), type: "original-divider", version: 1 };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.className = config.theme.divider || "";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <hr aria-label="分隔线" contentEditable={false} />;
  }
}

export function $createDividerNode(): DividerNode {
  return $applyNodeReplacement(new DividerNode());
}

export function $isDividerNode(node: LexicalNode | null | undefined): node is DividerNode {
  return node instanceof DividerNode;
}
