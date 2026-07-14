import { ChevronRight, Folder, FolderOpen, HardDrive } from "lucide-react";
import Link from "next/link";
import type { MediaFolder, MediaKind } from "@/lib/media";

type FolderNode = MediaFolder & { children: FolderNode[] };

function folderHref(basePath: string, kind: MediaKind, folder: string, query: string): string {
  const params = new URLSearchParams({ kind });
  if (folder) {
    params.set("folder", folder);
  }
  if (query) {
    params.set("q", query);
  }
  return `${basePath}?${params.toString()}`;
}

function buildFolderTree(folders: MediaFolder[]): FolderNode[] {
  const nodes = new Map(folders.map((folder) => [folder.path, { ...folder, children: [] as FolderNode[] }]));
  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.path)!;
    const parentPath = folder.path.split("/").slice(0, -1).join("/");
    const parent = nodes.get(parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function FolderBranch({
  node,
  kind,
  activeFolder,
  basePath,
  query,
}: {
  node: FolderNode;
  kind: MediaKind;
  activeFolder: string;
  basePath: "/media" | "/admin/media";
  query: string;
}) {
  const active = activeFolder === node.path;
  const containsActive = activeFolder.startsWith(`${node.path}/`);
  const Icon = active ? FolderOpen : Folder;
  const link = (
    <Link className={active ? "isActive" : ""} href={folderHref(basePath, kind, node.path, query)} title={node.path}>
      <Icon size={16} aria-hidden="true" />
      <span>{node.name}</span>
      <small>{node.directAssets}</small>
    </Link>
  );

  if (!node.children.length) {
    return <div className="mediaFolderNode">{link}</div>;
  }
  return (
    <details className="mediaFolderNode hasChildren" open={active || containsActive}>
      <summary>
        <ChevronRight size={14} aria-hidden="true" />
        {link}
      </summary>
      <div className="mediaFolderChildren">
        {node.children.map((child) => (
          <FolderBranch node={child} kind={kind} activeFolder={activeFolder} basePath={basePath} query={query} key={child.path} />
        ))}
      </div>
    </details>
  );
}

export function MediaFolderTree({
  kind,
  folders,
  activeFolder,
  basePath,
  query = "",
}: {
  kind: MediaKind;
  folders: MediaFolder[];
  activeFolder: string;
  basePath: "/media" | "/admin/media";
  query?: string;
}) {
  return (
    <nav className="mediaFolderTree" aria-label="资源文件夹">
      <Link className={!activeFolder ? "isActive mediaFolderRoot" : "mediaFolderRoot"} href={folderHref(basePath, kind, "", query)}>
        <HardDrive size={16} aria-hidden="true" />
        <span>根目录</span>
      </Link>
      {buildFolderTree(folders).map((node) => (
        <FolderBranch node={node} kind={kind} activeFolder={activeFolder} basePath={basePath} query={query} key={node.path} />
      ))}
    </nav>
  );
}
