"use client";

import type { JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  SKIP_DOM_SELECTION_TAG,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useBlockSelection } from "./block-selection";
import styles from "../OriginalComposer.module.css";

export type OriginalImagePayload = {
  assetId?: number | null;
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
  __assetId: number | null;
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
    this.__assetId = Number.isSafeInteger(payload.assetId) && Number(payload.assetId) > 0 ? Number(payload.assetId) : null;
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
      assetId: this.__assetId ?? undefined,
      src: this.__src,
      altText: this.__altText,
      caption: this.__caption,
      width: this.__width,
      height: this.__height,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.className = config.theme.image || "";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  setSize(width: number, height: number): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  decorate(): JSX.Element {
    return (
      <OriginalImage
        nodeKey={this.getKey()}
        src={this.__src}
        altText={this.__altText}
        caption={this.__caption}
        width={this.__width}
        height={this.__height}
      />
    );
  }
}

/** A Markdown image carries no dimensions, so the node starts at the 1x1 sentinel.
 *  Rendering that verbatim produced a one-pixel image; instead leave the box to CSS
 *  until the bitmap loads, then write the natural size back so later round trips
 *  through Markdown can reserve the right space. */
function OriginalImage({
  nodeKey,
  src,
  altText,
  caption,
  width,
  height,
}: {
  nodeKey: NodeKey;
  src: string;
  altText: string;
  caption: string;
  width: number;
  height: number;
}) {
  const [editor] = useLexicalComposerContext();
  const [selected, ref] = useBlockSelection<HTMLElement>(nodeKey);
  const known = width > 1 && height > 1;
  return (
    <figure ref={ref} className={`${styles.editorImage}${selected ? ` ${styles.blockSelected}` : ""}`} contentEditable={false}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={altText}
        width={known ? width : undefined}
        height={known ? height : undefined}
        style={known ? undefined : { aspectRatio: "auto" }}
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (known || !image.naturalWidth || !image.naturalHeight) return;
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isOriginalImageNode(node)) node.setSize(image.naturalWidth, image.naturalHeight);
          }, { tag: [SKIP_DOM_SELECTION_TAG, "image-measure"] });
        }}
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function $createOriginalImageNode(payload: OriginalImagePayload): OriginalImageNode {
  return $applyNodeReplacement(new OriginalImageNode(payload));
}

export function $isOriginalImageNode(node: LexicalNode | null | undefined): node is OriginalImageNode {
  return node instanceof OriginalImageNode;
}
