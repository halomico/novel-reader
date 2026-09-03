"use client";

import crypto from "node:crypto";
import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import { HeadingNode, type HeadingTagType } from "@lexical/rich-text";

export type SerializedOriginalHeadingNode = Spread<
  { type: "original-heading"; version: 1; tag: HeadingTagType; anchorId: string },
  SerializedElementNode
>;

function newAnchorId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `heading_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `heading_${crypto.randomBytes(16).toString("hex")}`;
}

export class OriginalHeadingNode extends HeadingNode {
  __anchorId: string;

  static getType(): string {
    return "original-heading";
  }

  static clone(node: OriginalHeadingNode): OriginalHeadingNode {
    return new OriginalHeadingNode(node.getTag(), node.__anchorId, node.__key);
  }

  static importJSON(serializedNode: SerializedOriginalHeadingNode): OriginalHeadingNode {
    return $createOriginalHeadingNode(serializedNode.tag, serializedNode.anchorId)
      .updateFromJSON(serializedNode);
  }

  constructor(tag: HeadingTagType = "h2", anchorId = newAnchorId(), key?: NodeKey) {
    super(tag, key);
    this.__anchorId = /^heading_[A-Za-z0-9_-]{8,80}$/u.test(anchorId) ? anchorId : newAnchorId();
  }

  exportJSON(): SerializedOriginalHeadingNode {
    return {
      ...super.exportJSON(),
      type: "original-heading",
      version: 1,
      tag: this.getTag(),
      anchorId: this.__anchorId,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.id = this.__anchorId;
    element.dataset.originalHeading = this.__anchorId;
    return element;
  }

  getAnchorId(): string {
    return this.getLatest().__anchorId;
  }
}

export function $createOriginalHeadingNode(tag: HeadingTagType = "h2", anchorId?: string): OriginalHeadingNode {
  return $applyNodeReplacement(new OriginalHeadingNode(tag, anchorId));
}

export function $isOriginalHeadingNode(node: LexicalNode | null | undefined): node is OriginalHeadingNode {
  return node instanceof OriginalHeadingNode;
}
