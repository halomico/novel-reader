import { Folder, FolderOpen, HardDrive } from "lucide-react";
import Link from "next/link";
import type { MediaFolder, MediaKind } from "@/lib/media";

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
      <Link className={!activeFolder ? "isActive" : ""} href={folderHref(basePath, kind, "", query)}>
        <HardDrive size={16} aria-hidden="true" />
        <span>根目录</span>
      </Link>
      {folders.map((folder) => {
        const active = activeFolder === folder.path;
        const Icon = active ? FolderOpen : Folder;
        return (
          <Link
            className={active ? "isActive" : ""}
            href={folderHref(basePath, kind, folder.path, query)}
            style={{ paddingLeft: `${10 + folder.depth * 15}px` }}
            title={folder.path}
            key={folder.path}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{folder.name}</span>
            <small>{folder.directAssets}</small>
          </Link>
        );
      })}
    </nav>
  );
}
