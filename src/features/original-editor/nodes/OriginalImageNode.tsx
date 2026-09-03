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

export type OriginalImagePayload = {
  assetId: number;
  src: string;
  altText: string;
  caption: string;
  width: number;
  height: number;
};

export type SerializedOriginalImageNode = Spread<
  OriginalImagePayload & { type: "original-image"; version: 1 },
  SerializedLexicalNode
>;

export class OriginalImageNode extends DecoratorNode<JSX.Element> {
  __assetId: number;
  __src: string;
  __altText: string;
  __caption: string;
  __width: number;
  __height: number;

  static getType(): string {
    return "original-image";
  }

  static clone(node: OriginalImageNode): OriginalImageNode {
    return new OriginalImageNode({
      assetId: node.__assetId,
      src: node.__src,
      altText: node.__altText,
      caption: node.__caption,
      width: node.__width,
      height: node.__height,
    }, node.__key);
  }

  static importJSON(node: SerializedOriginalImageNode): OriginalImageNode {
    return $createOriginalImageNode(node);
  }

  constructor(payload: OriginalImagePayload, key?: NodeKey) {
    super(key);
    this.__assetId = payload.assetId;
    this.__src = payload.src;
    this.__altText = payload.altText;
    this.__caption = payload.caption;
    this.__width = payload.width;
    this.__height = payload.height;
  }

  exportJSON(): SerializedOriginalImageNode {
    return {
      ...super.exportJSON(),
      type: "original-image",
      version: 1,
      assetId: this.__assetId,
      src: this.__src,
      altText: this.__altText,
      caption: this.__caption,
      width: this.__width,
      height: this.__height,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("figure");
    element.className = config.theme.image || "";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <figure className={styles.editorImage} contentEditable={false}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={this.__src}
          alt={this.__altText}
          width={this.__width}
          height={this.__height}
          draggable={false}
        />
        {this.__caption ? <figcaption>{this.__caption}</figcaption> : null}
      </figure>
    );
  }
}

export function $createOriginalImageNode(payload: OriginalImagePayload): OriginalImageNode {
  return $applyNodeReplacement(new OriginalImageNode(payload));
}

export function $isOriginalImageNode(node: LexicalNode | null | undefined): node is OriginalImageNode {
  return node instanceof OriginalImageNode;
}
