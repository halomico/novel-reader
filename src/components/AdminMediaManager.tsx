"use client";

import { ChevronRight, Clapperboard, File, Folder, Headphones, ListChecks, Pencil, Save, Tags, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignAdminVideoCategoryAction,
  batchUpdateAdminMediaAction,
  deleteAdminMediaAction,
  loadAdminMediaSelectionAction,
  updateAdminMediaAction,
} from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import { MediaVideoPreview } from "@/components/MediaVideoPreview";
import { usePersistentSelection } from "@/components/usePersistentSelection";
import type { MediaAsset, MediaFolder, MediaKind, MediaSortBy, MediaSortOrder, VideoCategory } from "@/lib/media";

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };
const ACCEPT_TYPES: Record<MediaKind, string> = {
  video: ".mp4,.m4v,.mov,.ogv,.webm,video/*",
  audio: ".aac,.flac,.m4a,.mp3,.oga,.ogg,.wav,.webm,audio/*",
  file: "*/*",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDuration(durationSeconds: number | null): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return "--:--";
  const totalSeconds = Math.floor(durationSeconds);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  return totalMinutes < 60
    ? `${totalMinutes}:${seconds}`
    : `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}:${seconds}`;
}

async function responseJson(response: Response): Promise<{ ok?: boolean; message?: string; uploadId?: string; chunkBytes?: number }> {
  try {
    return (await response.json()) as { ok?: boolean; message?: string; uploadId?: string; chunkBytes?: number };
  } catch {
    return { message: "上传接口返回异常" };
  }
}

function AdminMediaFolderRow({ folder, onOpen }: { folder: MediaFolder; onOpen: () => void }) {
  const pointerType = useRef("");

  return (
    <tr
      className="adminMediaFolderRow"
      tabIndex={0}
      title={`双击打开 ${folder.path}`}
      aria-label={`打开文件夹 ${folder.name}`}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onClick={() => {
        if (pointerType.current !== "mouse") onOpen();
      }}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <td aria-hidden="true" />
      <td><span className="adminMediaKind is-folder"><Folder size={14} aria-hidden="true" />文件夹</span></td>
      <td title={folder.name}><strong>{folder.name}</strong></td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td title={folder.path}>{folder.path}</td>
      <td>{formatBytes(folder.totalSizeBytes)}</td>
      <td>{folder.directAssets} 个直属资源</td>
      <td><LocalDateTime value={folder.mtimeMs ? new Date(folder.mtimeMs).toISOString() : null} /></td>
      <td><ChevronRight size={16} aria-hidden="true" /></td>
    </tr>
  );
}

function canPreview(asset: MediaAsset): boolean {
  return asset.kind === "video" || asset.kind === "audio";
}

function AdminMediaTitleLink({ asset, children }: { asset: MediaAsset; children: React.ReactNode }) {
  if (!canPreview(asset)) {
    return <>{children}</>;
  }
  return (
    <Link className="adminMediaPreviewLink" href={`/admin/media/${asset.id}/preview`} title={`预览 ${asset.title}`}>
      {children}
    </Link>
  );
}

export function AdminMediaManager({
  assets,
  totalAssets,
  folders,
  directFolders,
  query,
  sortBy,
  sortOrder,
  initialKind,
  initialFolder = "",
  returnPath,
  categories,
  categoryParam = "",
  view = "table",
  thumbnail,
}: {
  assets: MediaAsset[];
  totalAssets: number;
  folders: Record<MediaKind, MediaFolder[]>;
  directFolders: MediaFolder[];
  query: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  initialKind?: MediaKind;
  initialFolder?: string;
  returnPath: string;
  categories: VideoCategory[];
  categoryParam?: string;
  view?: "table" | "grid";
  thumbnail: {
    mode: "single" | "carousel";
    singlePercent: number;
    carouselFrames: number;
    carouselIntervalSeconds: number;
  };
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kind = initialKind;
  const [folder, setFolder] = useState(initialFolder);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [description, setDescription] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState(/^\d+$/.test(categoryParam) ? categoryParam : "");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const { selectedIds, toggleOne, togglePage, clearSelection } = usePersistentSelection(
    `novel-reader-admin-media-selection:${kind || "all"}`,
  );
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [batchEditing, setBatchEditing] = useState(false);
  const [batchAssets, setBatchAssets] = useState<MediaAsset[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");
  const visibleIds = assets.map((asset) => asset.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const selectedAssets = batchAssets;
  const selectedKind = selectedAssets.length && selectedAssets.every((asset) => asset.kind === selectedAssets[0].kind)
    ? selectedAssets[0].kind
    : undefined;

  useEffect(() => {
    setEditingAsset(null);
    setBatchEditing(false);
    setBatchAssets([]);
    setBatchError("");
  }, [assets]);

  useEffect(() => {
    setFolder(initialFolder);
    setUploadCategoryId(/^\d+$/.test(categoryParam) ? categoryParam : "");
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [categoryParam, initialFolder, initialKind]);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files || []);
    setFiles(nextFiles);
    if (!nextFiles.length) {
      setMessage("");
      return;
    }
    const totalBytes = nextFiles.reduce((sum, item) => sum + item.size, 0);
    setMessage(`已选择 ${nextFiles.length} 个文件（${formatBytes(totalBytes)}）`);
    if (nextFiles.length === 1) {
      if (!title.trim()) {
        setTitle(nextFiles[0].name.replace(/\.[^.]+$/, ""));
      }
    } else {
      setTitle("");
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || !files.length || isUploading) {
      return;
    }
    const uploadFiles = [...files];
    const totalBytes = Math.max(uploadFiles.reduce((sum, item) => sum + item.size, 0), 1);
    let uploadedBytes = 0;
    let completedFiles = 0;
    setIsUploading(true);
    setProgress(0);
    setMessage(`准备上传 ${uploadFiles.length} 个文件`);
    try {
      for (const [fileIndex, file] of uploadFiles.entries()) {
        let uploadId = "";
        try {
          setMessage(`正在创建任务 ${fileIndex + 1}/${uploadFiles.length} · ${file.name}`);
          const startResponse = await fetch("/admin/media/upload?action=start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind,
              categoryId: kind === "video" ? uploadCategoryId : undefined,
              title: uploadFiles.length === 1 ? title : "",
              artist,
              description,
              folder,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            }),
          });
          const startData = await responseJson(startResponse);
          if (!startResponse.ok || !startData.uploadId || !startData.chunkBytes) {
            throw new Error(startData.message || "无法创建上传任务");
          }
          uploadId = startData.uploadId;

          for (let offset = 0; offset < file.size; offset += startData.chunkBytes) {
            const chunk = file.slice(offset, Math.min(offset + startData.chunkBytes, file.size));
            const chunkResponse = await fetch(`/admin/media/upload?action=chunk&uploadId=${uploadId}`, {
              method: "POST",
              headers: { "content-type": "application/octet-stream", "x-upload-offset": String(offset) },
              body: chunk,
            });
            const chunkData = await responseJson(chunkResponse);
            if (!chunkResponse.ok) {
              throw new Error(chunkData.message || "文件分片上传失败");
            }
            const nextOffset = Math.min(offset + chunk.size, file.size);
            setProgress(Math.round(((uploadedBytes + nextOffset) / totalBytes) * 100));
            setMessage(`正在上传 ${fileIndex + 1}/${uploadFiles.length} · ${file.name}`);
          }

          const finishResponse = await fetch(`/admin/media/upload?action=finish&uploadId=${uploadId}`, { method: "POST" });
          const finishData = await responseJson(finishResponse);
          if (!finishResponse.ok) {
            throw new Error(finishData.message || "资源保存失败");
          }
          uploadedBytes += file.size;
          completedFiles += 1;
          setProgress(Math.round((uploadedBytes / totalBytes) * 100));
        } catch (error) {
          if (uploadId) {
            void fetch(`/admin/media/upload?uploadId=${uploadId}`, { method: "DELETE" });
          }
          const reason = error instanceof Error ? error.message : "上传失败";
          throw new Error(completedFiles ? `已完成 ${completedFiles} 个，${file.name} 上传失败：${reason}` : `${file.name} 上传失败：${reason}`);
        }
      }

      setMessage(`已上传 ${completedFiles} 个资源`);
      setFiles([]);
      setTitle("");
      setArtist("");
      setDescription("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  function toggleAll() {
    togglePage(visibleIds);
  }

  async function openBatchEditor() {
    setBatchEditing(true);
    setBatchAssets([]);
    setBatchLoading(false);
    setBatchError("");
    if (selectedIds.length > 100) {
      setBatchError("批量编辑每次最多选择 100 个资源；删除和视频归类不受此限制。");
      return;
    }
    setBatchLoading(true);
    try {
      const selected = await loadAdminMediaSelectionAction(selectedIds);
      if (!selected.length) {
        setBatchError("所选资源已不存在，请清除选择后重试。");
      } else {
        setBatchAssets(selected);
      }
    } catch {
      setBatchError("无法读取所选资源，请稍后重试。");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <>
      {kind ? <form className="adminMediaUpload" onSubmit={upload}>
        <div className={`adminMediaUploadFields${kind !== "file" ? " hasArtist" : ""}${kind === "video" ? " hasCategory" : ""}`}>
          <label>
            <span>名称</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder={files.length > 1 ? "批量上传使用各自文件名" : "留空时使用文件名"}
              disabled={isUploading || files.length > 1}
            />
          </label>
          {kind !== "file" ? (
            <label>
              <span>作者</span>
              <input value={artist} onChange={(event) => setArtist(event.target.value)} maxLength={80} placeholder="可选，本批次共用" disabled={isUploading} />
            </label>
          ) : null}
          {kind === "video" ? (
            <label>
              <span>分类</span>
              <select value={uploadCategoryId} onChange={(event) => setUploadCategoryId(event.target.value)} disabled={isUploading}>
                <option value="">未分类</option>
                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>选择{KIND_LABELS[kind]}</span>
            <input ref={fileInputRef} type="file" accept={ACCEPT_TYPES[kind]} onChange={chooseFiles} disabled={isUploading} multiple required />
          </label>
          <label>
            <span>上传到</span>
            <select value={folder} onChange={(event) => setFolder(event.target.value)} disabled={isUploading}>
              <option value="">根目录</option>
              {folders[kind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
            </select>
          </label>
          <label className="adminMediaDescriptionField">
            <span>简介</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="可选，本批次共用" disabled={isUploading} />
          </label>
          <button className="adminMediaUploadButton" type="submit" disabled={!files.length || isUploading}>
            <Upload size={17} aria-hidden="true" />
            {isUploading ? "上传中" : files.length > 1 ? `上传 ${files.length} 个` : "上传"}
          </button>
        </div>
        {message ? (
          <div className="adminMediaUploadStatus" aria-live="polite">
            <span>{message}</span>
            {isUploading ? <progress max="100" value={progress}>{progress}%</progress> : null}
          </div>
        ) : null}
      </form> : null}

      {assets.length || directFolders.length ? (
        <>
          {view === "grid" && kind === "video" ? (
            <div className="adminMediaGridContent">
              {directFolders.length ? (
                <div className="adminMediaGridFolders">
                  {directFolders.map((item) => (
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams({ kind, folder: item.path, sort: sortBy, order: sortOrder, view });
                        if (query) params.set("q", query);
                        if (categoryParam) params.set("category", categoryParam);
                        router.push(`/admin/media?${params.toString()}`);
                      }}
                      title={`打开 ${item.path}`}
                      key={item.path}
                    >
                      <Folder size={18} aria-hidden="true" />
                      <span>{item.name}</span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="adminMediaVideoGrid">
                {assets.map((asset) => (
                  <article className={selectedIds.includes(asset.id) ? "adminMediaVideoItem isSelected" : "adminMediaVideoItem"} key={asset.id}>
                    <label className="adminMediaVideoSelect" title={`选择 ${asset.title}`}>
                      <input className="adminCheckbox" type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleOne(asset.id)} aria-label={`选择 ${asset.title}`} />
                    </label>
                    <div className="adminMediaVideoThumbnail">
                      <MediaVideoPreview
                        id={asset.id}
                        mode={thumbnail.mode}
                        singlePercent={thumbnail.singlePercent}
                        frameCount={thumbnail.carouselFrames}
                        intervalSeconds={thumbnail.carouselIntervalSeconds}
                        sourceVersion={asset.mtimeMs}
                        admin
                      />
                      <span className="mediaVideoMeta">{formatDuration(asset.durationSeconds)}</span>
                    </div>
                    <div className="adminMediaVideoCopy">
                      <AdminMediaTitleLink asset={asset}>
                        <strong title={asset.title}>{asset.title}</strong>
                      </AdminMediaTitleLink>
                      <span>
                        {asset.categoryId ? categoryNames.get(asset.categoryId) || "未分类" : "未分类"}
                        {asset.artist ? ` · ${asset.artist}` : ""}
                      </span>
                      <small title={asset.fileName}>{asset.fileName}</small>
                    </div>
                    <div className="adminMediaGridActions">
                      <button className="adminTableIconButton" type="button" onClick={() => setEditingAsset(asset)} aria-label={`编辑 ${asset.title}`} title="编辑">
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="adminTableWrap adminMediaTableWrap">
              <table className="adminTable adminMediaTable">
                <thead>
                  <tr>
                    <th aria-label="选择资源"><input className="adminCheckbox" type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                    <th>类型</th>
                    <th>名称</th>
                    <th>分类</th>
                    <th>作者</th>
                    <th>文件名</th>
                    <th>目录</th>
                    <th>大小</th>
                    <th>播放/下载</th>
                    <th>更新时间</th>
                    <th aria-label="编辑">编辑</th>
                  </tr>
                </thead>
                <tbody>
                  {directFolders.map((item) => (
                    <AdminMediaFolderRow
                      folder={item}
                      onOpen={() => {
                        if (!kind) return;
                        const params = new URLSearchParams({ kind, folder: item.path });
                        if (query) params.set("q", query);
                        if (categoryParam) params.set("category", categoryParam);
                        if (view === "grid") params.set("view", view);
                        params.set("sort", sortBy);
                        params.set("order", sortOrder);
                        router.push(`/admin/media?${params.toString()}`);
                      }}
                      key={item.path}
                    />
                  ))}
                  {assets.map((asset) => {
                    const Icon = KIND_ICONS[asset.kind];
                    return (
                      <tr key={asset.id}>
                        <td><input className="adminCheckbox" type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleOne(asset.id)} aria-label={`选择 ${asset.title}`} /></td>
                        <td><span className={`adminMediaKind is-${asset.kind}`}><Icon size={14} aria-hidden="true" />{KIND_LABELS[asset.kind]}</span></td>
                        <td title={asset.title}>
                          <AdminMediaTitleLink asset={asset}>
                            <strong>{asset.title}</strong>
                          </AdminMediaTitleLink>
                        </td>
                        <td>{asset.kind === "video" ? (asset.categoryId ? categoryNames.get(asset.categoryId) || "未分类" : "未分类") : "-"}</td>
                        <td title={asset.artist}>{asset.kind === "file" ? "-" : asset.artist || "-"}</td>
                        <td title={asset.fileName}>{asset.fileName}</td>
                        <td title={asset.folder || "根目录"}>{asset.folder || "根目录"}</td>
                        <td>{formatBytes(asset.sizeBytes)}</td>
                        <td>{asset.kind === "file" ? `${asset.downloadCount} 次下载` : `${asset.playCount} 次播放`}</td>
                        <td><LocalDateTime value={asset.updatedAt} /></td>
                        <td>
                          <button className="adminTableIconButton" type="button" onClick={() => setEditingAsset(asset)} aria-label={`编辑 ${asset.title}`} title="编辑">
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="adminTableFooter adminMediaFooter">
            <div className="adminMediaBulkActions">
              <button className="adminIconTextButton" type="button" disabled={!selectedIds.length} onClick={() => void openBatchEditor()}>
                <ListChecks size={15} aria-hidden="true" />批量编辑
              </button>
              {selectedIds.length ? (
                <button className="adminTableIconButton" type="button" onClick={clearSelection} aria-label="清除全部选择" title="清除选择">
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
              {kind === "video" ? (
                <form className="adminMediaCategoryBulkForm" action={assignAdminVideoCategoryAction}>
                  <input name="returnPath" type="hidden" value={returnPath} />
                  {selectedIds.map((id) => <input name="mediaIds" type="hidden" value={id} key={id} />)}
                  <select name="categoryId" aria-label="批量设置视频分类" disabled={!selectedIds.length}>
                    <option value="">未分类</option>
                    {categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                  </select>
                  <button className="adminIconTextButton" type="submit" disabled={!selectedIds.length}>
                    <Tags size={15} aria-hidden="true" />归类
                  </button>
                </form>
              ) : null}
              <form action={deleteAdminMediaAction} onSubmit={clearSelection}>
                <input name="returnPath" type="hidden" value={returnPath} />
                {selectedIds.map((id) => <input name="mediaIds" type="hidden" value={id} key={id} />)}
                <button className="adminDangerButton" type="submit" disabled={!selectedIds.length}>
                  <Trash2 size={16} aria-hidden="true" />
                  删除所选
                </button>
              </form>
            </div>
            <span>
              当前显示 {directFolders.length} 个文件夹、{assets.length} 个资源，共 {totalAssets} 个资源
              {selectedIds.length ? `；已选 ${selectedIds.length} 个` : ""}
            </span>
          </div>
        </>
      ) : null}

      {batchEditing ? (
        <div className="adminMediaEditBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setBatchEditing(false)}>
          <form className="adminMediaEditDialog adminMediaBatchDialog" action={batchUpdateAdminMediaAction} role="dialog" aria-modal="true" aria-labelledby="admin-media-batch-title">
            <header>
              <div>
                <h3 id="admin-media-batch-title">批量编辑资源</h3>
                <p>已选择 {selectedIds.length} 项</p>
              </div>
              <button type="button" onClick={() => setBatchEditing(false)} aria-label="关闭批量编辑" title="关闭"><X size={18} aria-hidden="true" /></button>
            </header>
            <input name="returnPath" type="hidden" value={returnPath} />
            {batchLoading ? <p className="adminInlineMessage">正在读取所选资源...</p> : null}
            {batchError ? <p className="adminInlineMessage isWarning">{batchError}</p> : null}
            {selectedAssets.length ? (
              <>
                {selectedAssets.map((asset) => <input name="mediaIds" type="hidden" value={asset.id} key={asset.id} />)}
                <div className="adminMediaBatchTitles">
                  {selectedAssets.map((asset, index) => (
                    <label key={asset.id}>
                      <span>{asset.fileName}</span>
                      <input name={`title-${asset.id}`} defaultValue={asset.title} maxLength={120} required autoFocus={index === 0} />
                    </label>
                  ))}
                </div>
                {selectedAssets.some((asset) => asset.kind !== "file") ? (
                  <label className="adminMediaBatchApplyField">
                    <span><input name="applyArtist" type="checkbox" />统一作者</span>
                    <input name="artist" maxLength={80} placeholder="勾选后应用；留空可清除" />
                  </label>
                ) : null}
                <label className="adminMediaBatchApplyField">
                  <span><input name="applyDescription" type="checkbox" />统一简介</span>
                  <textarea name="description" maxLength={1000} rows={3} placeholder="勾选后应用；留空可清除" />
                </label>
                {selectedKind ? (
                  <label>
                    <span>移动到</span>
                    <select name="targetFolder" defaultValue="__keep__">
                      <option value="__keep__">保持原目录</option>
                      <option value="">根目录</option>
                      {folders[selectedKind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
                    </select>
                  </label>
                ) : null}
                {selectedKind === "video" ? (
                  <label>
                    <span>视频分类</span>
                    <select name="categoryId" defaultValue="__keep__">
                      <option value="__keep__">保持原分类</option>
                      <option value="">未分类</option>
                      {categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                    </select>
                  </label>
                ) : null}
                <footer>
                  <button className="adminSecondaryButton" type="button" onClick={() => setBatchEditing(false)}>取消</button>
                  <button type="submit"><Save size={16} aria-hidden="true" />保存</button>
                </footer>
              </>
            ) : null}
          </form>
        </div>
      ) : null}

      {editingAsset ? (
        <div className="adminMediaEditBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingAsset(null)}>
          <form className="adminMediaEditDialog" action={updateAdminMediaAction} role="dialog" aria-modal="true" aria-labelledby="admin-media-edit-title">
            <header>
              <div>
                <h3 id="admin-media-edit-title">编辑资源</h3>
                <p>{editingAsset.fileName}</p>
              </div>
              <button type="button" onClick={() => setEditingAsset(null)} aria-label="关闭编辑" title="关闭"><X size={18} aria-hidden="true" /></button>
            </header>
            <input name="mediaId" type="hidden" value={editingAsset.id} />
            <input name="returnPath" type="hidden" value={returnPath} />
            <label>
              <span>名称</span>
              <input name="title" defaultValue={editingAsset.title} maxLength={120} required autoFocus />
            </label>
            {editingAsset.kind !== "file" ? (
              <label>
                <span>作者</span>
                <input name="artist" defaultValue={editingAsset.artist} maxLength={80} placeholder="可选" />
              </label>
            ) : null}
            {editingAsset.kind === "video" ? (
              <label>
                <span>分类</span>
                <select name="categoryId" defaultValue={editingAsset.categoryId || ""}>
                  <option value="">未分类</option>
                  {categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span>所在目录</span>
              <select name="targetFolder" defaultValue={editingAsset.folder}>
                <option value="">根目录</option>
                {folders[editingAsset.kind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
              </select>
            </label>
            <label>
              <span>简介</span>
              <textarea name="description" defaultValue={editingAsset.description} maxLength={1000} rows={5} />
            </label>
            <footer>
              <button className="adminSecondaryButton" type="button" onClick={() => setEditingAsset(null)}>取消</button>
              <button type="submit"><Save size={16} aria-hidden="true" />保存</button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
