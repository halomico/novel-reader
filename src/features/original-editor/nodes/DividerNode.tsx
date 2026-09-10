"use client";

import type { JSX } from "react";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,


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

  /**
   * A scene break is a block. `DecoratorNode.isInline()` defaults to true, so without
   * this the divider was inserted *inside* the current paragraph — it rendered as a
   * rule in the middle of a line, never became a root child, and was therefore never
   * serialized as `---`.
   */
  isInline(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <hr aria-label="分隔线" contentEditable={false} />;
  }
}

export function $createDividerNode(): DividerNode {
  return $applyNodeReplacement(new DividerNode());
}
