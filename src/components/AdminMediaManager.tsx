"use client";

import { ChevronDown, ChevronRight, Clapperboard, File, Folder, Headphones, ListChecks, Pencil, Save, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignAdminVideoTagsAction,
  batchUpdateAdminMediaAction,
  deleteAdminMediaAction,
  loadAdminMediaSelectionAction,
  updateAdminMediaAction,
} from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import { beginNavigationProgress } from "@/components/NavigationProgress";
import { usePersistentSelection } from "@/components/usePersistentSelection";
import { InlineMutationNotice, useInlineMutation } from "@/components/useInlineMutation";
import { VideoTagPicker } from "@/components/VideoTagPicker";
import type { MediaAsset, MediaFolder, MediaKind, MediaSortBy, MediaSortOrder, VideoCategory, VideoTag } from "@/lib/media";

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };
const ACCEPT_TYPES: Record<MediaKind, string> = {
  video: ".mp4,.m4v,.mov,.ts,.mts,.m2ts,.ogv,.webm,video/*",
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

type UploadResponse = {
  ok?: boolean;
  message?: string;
  uploadId?: string;
  uploadUrl?: string;
  uploadToken?: string;
  chunkBytes?: number;
  nextOffset?: number;
  assetId?: number;
};

async function responseJson(response: Response): Promise<UploadResponse> {
  try {
    return (await response.json()) as UploadResponse;
  } catch {
    return { message: "上传接口返回异常" };
  }
}

function uploadRequestHeaders(uploadToken: string | undefined, offset?: number): Record<string, string> {
  return {
    ...(uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {}),
    ...(offset === undefined
      ? {}
      : { "content-type": "application/octet-stream", "x-upload-offset": String(offset) }),
  };
}

function waitForRetry(attempt: number) {
  return new Promise((resolve) => window.setTimeout(resolve, 400 * 2 ** attempt));
}

async function finishUploadTask(uploadId: string): Promise<number> {
  let lastError = "资源保存失败";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`/admin/media/upload?action=finish&uploadId=${uploadId}`, { method: "POST" });
      const data = await responseJson(response);
      if (response.ok && Number.isInteger(data.assetId) && data.assetId! > 0) return data.assetId!;
      lastError = data.message || lastError;
      if (response.status < 500) break;
    } catch {
      lastError = "保存响应中断";
    }
    if (attempt < 2) await waitForRetry(attempt);
  }
  throw new Error(lastError);
}

function AdminMediaFolderRow({ folder, onOpen }: { folder: MediaFolder; onOpen: () => void }) {
  return (
    <tr
      className="adminMediaFolderRow"
      tabIndex={0}
      title={`打开 ${folder.path}`}
      aria-label={`打开文件夹 ${folder.name}`}
      onClick={onOpen}
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
      <td>{folder.totalAssets} 个资源</td>
      <td title={folder.path}>{folder.path}</td>
      <td>{formatBytes(folder.totalSizeBytes)}</td>
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
  videoTags,
  tagsByAsset,
  categoryParam = "",
}: {
  assets: MediaAsset[];
  totalAssets: number;
  folders: Record<MediaKind, MediaFolder[]>;
  directFolders: MediaFolder[];
  query: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  initialKind: MediaKind;
  initialFolder?: string;
  returnPath: string;
  categories: VideoCategory[];
  videoTags: VideoTag[];
  tagsByAsset: Record<number, VideoTag[]>;
  categoryParam?: string;
}) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kind = initialKind;
  const [visibleAssets, setVisibleAssets] = useState(assets);
  const [visibleTotalAssets, setVisibleTotalAssets] = useState(totalAssets);
  const [visibleTagsByAsset, setVisibleTagsByAsset] = useState(tagsByAsset);
  const [videoCategories, setVideoCategories] = useState(categories);
  const [folder, setFolder] = useState(initialFolder);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [description, setDescription] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState(/^\d+$/.test(categoryParam) ? categoryParam : "");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [uploadTagPickerKey, setUploadTagPickerKey] = useState(0);
  const { selectedIds, toggleOne, togglePage, clearSelection } = usePersistentSelection(
    `novel-reader-admin-media-selection:${kind}`,
  );
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [batchEditing, setBatchEditing] = useState(false);
  const [batchAssets, setBatchAssets] = useState<MediaAsset[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");
  const visibleIds = visibleAssets.map((asset) => asset.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const categoryNames = useMemo(
    () => new Map(videoCategories.map((category) => [category.id, category.name])),
    [videoCategories],
  );
  const selectedAssets = batchAssets;
  const selectedKind = selectedAssets.length && selectedAssets.every((asset) => asset.kind === selectedAssets[0].kind)
    ? selectedAssets[0].kind
    : undefined;

  useEffect(() => {
    setVisibleAssets(assets);
    setVisibleTotalAssets(totalAssets);
    setVisibleTagsByAsset(tagsByAsset);
    setEditingAsset(null);
    setBatchEditing(false);
    setBatchAssets([]);
    setBatchError("");
  }, [assets, tagsByAsset, totalAssets]);

  useEffect(() => {
    setVideoCategories(categories);
  }, [categories]);

  useEffect(() => {
    function updateCategories(event: Event) {
      const next = (event as CustomEvent<{ categories: VideoCategory[] }>).detail?.categories;
      if (!next) return;
      const validIds = new Set(next.map((category) => category.id));
      setVideoCategories(next);
      setVisibleAssets((current) => current.map((asset) => (
        asset.kind === "video" && asset.categoryId && !validIds.has(asset.categoryId)
          ? { ...asset, categoryId: null }
          : asset
      )));
    }
    window.addEventListener("admin-video-categories-changed", updateCategories);
    return () => window.removeEventListener("admin-video-categories-changed", updateCategories);
  }, []);

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
    if (!files.length || isUploading) {
      return;
    }
    const uploadFiles = [...files];
    const uploadTagIds = new FormData(event.currentTarget).getAll("tagIds").map(Number);
    const totalBytes = Math.max(uploadFiles.reduce((sum, item) => sum + item.size, 0), 1);
    let uploadedBytes = 0;
    let completedFiles = 0;
    let tagWarnings = 0;
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
              artist: kind === "audio" ? artist : "",
              description,
              folder,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            }),
          });
          const startData = await responseJson(startResponse);
          if (!startResponse.ok || !startData.uploadId || !startData.chunkBytes || !startData.uploadUrl) {
            throw new Error(startData.message || "无法创建上传任务");
          }
          uploadId = startData.uploadId;

          let offset = 0;
          while (offset < file.size) {
            const chunk = file.slice(offset, Math.min(offset + startData.chunkBytes, file.size));
            let nextOffset = offset;
            let lastError = "文件分片上传失败";
            for (let attempt = 0; attempt < 3 && nextOffset === offset; attempt += 1) {
              try {
                const chunkResponse = await fetch(startData.uploadUrl, {
                  method: "POST",
                  headers: uploadRequestHeaders(startData.uploadToken, offset),
                  body: chunk,
                });
                const chunkData = await responseJson(chunkResponse);
                if (
                  chunkResponse.ok &&
                  Number.isInteger(chunkData.nextOffset) &&
                  chunkData.nextOffset! > offset &&
                  chunkData.nextOffset! <= file.size
                ) {
                  nextOffset = chunkData.nextOffset!;
                  break;
                }
                lastError = chunkData.message || lastError;
              } catch {
                lastError = "上传连接中断";
              }

              try {
                const statusResponse = await fetch(startData.uploadUrl, {
                  headers: uploadRequestHeaders(startData.uploadToken),
                  cache: "no-store",
                });
                const statusData = await responseJson(statusResponse);
                if (
                  statusResponse.ok &&
                  Number.isInteger(statusData.nextOffset) &&
                  statusData.nextOffset! > offset &&
                  statusData.nextOffset! <= file.size
                ) {
                  nextOffset = statusData.nextOffset!;
                  break;
                }
              } catch {
                // Retry the same chunk after a short delay.
              }
              if (attempt < 2) await waitForRetry(attempt);
            }
            if (nextOffset === offset) {
              throw new Error(lastError);
            }
            offset = nextOffset;
            setProgress(Math.round(((uploadedBytes + nextOffset) / totalBytes) * 100));
            setMessage(`正在上传 ${fileIndex + 1}/${uploadFiles.length} · ${file.name}`);
          }

          setMessage(
            `${kind === "video" ? "正在处理并保存" : "正在保存"} ${fileIndex + 1}/${uploadFiles.length} · ${file.name}`,
          );
          const assetId = await finishUploadTask(uploadId);
          if (kind === "video" && uploadTagIds.length) {
            const tagData = new FormData();
            tagData.append("mediaIds", String(assetId));
            uploadTagIds.forEach((tagId) => tagData.append("tagIds", String(tagId)));
            try {
              const tagResult = await assignAdminVideoTagsAction(tagData);
              if (!tagResult.ok) tagWarnings += 1;
            } catch {
              tagWarnings += 1;
            }
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

      setMessage(`已上传 ${completedFiles} 个资源${tagWarnings ? `，${tagWarnings} 个标签关联需重新保存` : ""}`);
      setFiles([]);
      setTitle("");
      setArtist("");
      setDescription("");
      setUploadTagPickerKey((value) => value + 1);
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

  function mergeAssets(nextAssets: MediaAsset[]) {
    const byId = new Map(nextAssets.map((asset) => [asset.id, asset]));
    setVisibleAssets((current) => current.map((asset) => byId.get(asset.id) || asset));
  }

  function mergeTags(nextTags: Record<number, VideoTag[]>) {
    setVisibleTagsByAsset((current) => ({ ...current, ...nextTags }));
  }

  function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.length || !window.confirm(`确认删除所选 ${selectedIds.length} 个资源及其文件？`)) return;
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => deleteAdminMediaAction(formData),
      (result) => {
        const deletedIds = result.data?.deletedIds || [];
        if (deletedIds.length) {
          const deleted = new Set(deletedIds);
          setVisibleAssets((current) => current.filter((asset) => !deleted.has(asset.id)));
          setVisibleTotalAssets((current) => Math.max(0, current - deletedIds.length));
          clearSelection();
        }
      },
    );
  }

  function submitBatchEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => batchUpdateAdminMediaAction(formData),
      (result) => {
        if (result.data?.assets) mergeAssets(result.data.assets);
        if (result.data?.tagsByAsset) mergeTags(result.data.tagsByAsset);
        if (result.ok) {
          setBatchEditing(false);
          clearSelection();
        }
      },
    );
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => updateAdminMediaAction(formData),
      (result) => {
        if (!result.data?.asset) return;
        mergeAssets([result.data.asset]);
        mergeTags({ [result.data.asset.id]: result.data.tags || [] });
        if (result.ok) setEditingAsset(null);
      },
    );
  }

  return (
    <>
      <InlineMutationNotice notice={mutation.notice} />
      <details className="adminMediaUploadDisclosure">
        <summary>
          <span><Upload size={16} aria-hidden="true" />上传{KIND_LABELS[kind]}</span>
          <small>选择文件后确认上传</small>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <form className="adminMediaUpload" onSubmit={upload}>
          <div className={`adminMediaUploadFields is-${kind}`}>
            <label className="adminMediaFileField">
              <span>文件</span>
              <input ref={fileInputRef} type="file" accept={ACCEPT_TYPES[kind]} onChange={chooseFiles} disabled={isUploading} multiple required />
            </label>
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
            {kind === "audio" ? (
              <label>
                <span>作者</span>
                <input value={artist} onChange={(event) => setArtist(event.target.value)} maxLength={80} placeholder="可选，本批次共用" disabled={isUploading} />
              </label>
            ) : null}
            {kind === "video" ? (
              <label>
                <span>分类</span>
                <span className="adminSelectControl">
                  <select value={uploadCategoryId} onChange={(event) => setUploadCategoryId(event.target.value)} disabled={isUploading}>
                    <option value="">未分类</option>
                    {videoCategories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
            ) : null}
            <label>
              <span>所在目录</span>
              <span className="adminSelectControl">
                <select value={folder} onChange={(event) => setFolder(event.target.value)} disabled={isUploading}>
                  <option value="">根目录</option>
                  {folders[kind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
            <label className="adminMediaDescriptionField">
              <span>简介</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="可选，本批次共用" disabled={isUploading} />
            </label>
            {kind === "video" && videoTags.length ? (
              <div className="adminMediaTagField">
                <span>标签</span>
                <VideoTagPicker tags={videoTags} disabled={isUploading} key={uploadTagPickerKey} />
              </div>
            ) : null}
          </div>
          <footer className="adminMediaUploadFooter">
            {message ? (
              <div className="adminMediaUploadStatus" aria-live="polite">
                <span>{message}</span>
                {isUploading ? <progress max="100" value={progress}>{progress}%</progress> : null}
              </div>
            ) : <span />}
            <button className="adminMediaUploadButton" type="submit" disabled={!files.length || isUploading}>
              <Upload size={16} aria-hidden="true" />
              {isUploading ? "上传中" : files.length > 1 ? `上传 ${files.length} 个` : "上传"}
            </button>
          </footer>
        </form>
      </details>

      {visibleAssets.length || directFolders.length ? (
        <>
          <div className="adminTableWrap adminMediaTableWrap">
            <table className="adminTable adminMediaTable">
              <thead>
                <tr>
                  <th aria-label="选择资源"><input className="adminCheckbox" type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                  <th>类型</th>
                  <th>名称</th>
                  <th>分类 / 标签</th>
                  <th>目录</th>
                  <th>数据</th>
                  <th>更新时间</th>
                  <th aria-label="操作">操作</th>
                </tr>
              </thead>
              <tbody>
                {directFolders.map((item) => (
                  <AdminMediaFolderRow
                    folder={item}
                    onOpen={() => {
                      const params = new URLSearchParams({ kind, folder: item.path });
                      if (query) params.set("q", query);
                      if (categoryParam) params.set("category", categoryParam);
                      params.set("sort", sortBy);
                      params.set("order", sortOrder);
                      beginNavigationProgress();
                      router.push(`/admin/media?${params.toString()}`);
                    }}
                    key={item.path}
                  />
                ))}
                {visibleAssets.map((asset) => {
                  const Icon = KIND_ICONS[asset.kind];
                  return (
                    <tr key={asset.id}>
                      <td><input className="adminCheckbox" type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleOne(asset.id)} aria-label={`选择 ${asset.title}`} /></td>
                      <td><span className={`adminMediaKind is-${asset.kind}`}><Icon size={14} aria-hidden="true" />{KIND_LABELS[asset.kind]}</span></td>
                      <td className="adminMediaTitleCell" title={asset.title}>
                        <AdminMediaTitleLink asset={asset}>
                          <strong>{asset.title}</strong>
                        </AdminMediaTitleLink>
                        <small title={asset.fileName}>{asset.fileName}</small>
                      </td>
                      <td className="adminMediaTaxonomyCell">
                        {asset.kind === "video" ? (
                          <>
                            <span>{asset.categoryId ? categoryNames.get(asset.categoryId) || "未分类" : "未分类"}</span>
                            {visibleTagsByAsset[asset.id]?.length ? (
                              <small className="contentTag" title={visibleTagsByAsset[asset.id].map((tag) => `#${tag.name}`).join(" ")}>
                                {visibleTagsByAsset[asset.id].slice(0, 3).map((tag) => `#${tag.name}`).join(" ")}
                              </small>
                            ) : null}
                          </>
                        ) : asset.kind === "audio" ? <span title={asset.artist}>{asset.artist || "未标注作者"}</span> : <span>{asset.mimeType}</span>}
                      </td>
                      <td title={asset.folder || "根目录"}>{asset.folder || "根目录"}</td>
                      <td className="adminMediaDataCell">
                        <span>{formatBytes(asset.sizeBytes)}</span>
                        <small>{asset.kind === "file" ? `${asset.downloadCount} 次下载` : `${asset.playCount} 次播放`}</small>
                      </td>
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
          <div className="adminTableFooter adminMediaFooter">
            <div className="adminMediaBulkActions">
              <button className="adminIconTextButton" type="button" disabled={!selectedIds.length} onClick={() => void openBatchEditor()}>
                <ListChecks size={15} aria-hidden="true" />批量编辑{selectedIds.length ? `（${selectedIds.length}）` : ""}
              </button>
              <form onSubmit={submitDelete}>
                <input name="returnPath" type="hidden" value={returnPath} />
                {selectedIds.map((id) => <input name="mediaIds" type="hidden" value={id} key={id} />)}
                <button className="adminDangerButton" type="submit" disabled={!selectedIds.length || mutation.pending}>
                  <Trash2 size={16} aria-hidden="true" />
                  删除所选
                </button>
              </form>
            </div>
            <span>
              当前显示 {directFolders.length} 个文件夹、{visibleAssets.length} 个资源，共 {visibleTotalAssets} 个资源
              {selectedIds.length ? `；已选 ${selectedIds.length} 个` : ""}
            </span>
          </div>
        </>
      ) : null}

      {batchEditing ? (
        <div className="adminMediaEditBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setBatchEditing(false)}>
          <form className="adminMediaEditDialog adminMediaBatchDialog" onSubmit={submitBatchEdit} role="dialog" aria-modal="true" aria-labelledby="admin-media-batch-title">
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
                {selectedKind === "audio" ? (
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
                    <span className="adminSelectControl">
                      <select name="targetFolder" defaultValue="__keep__">
                        <option value="__keep__">保持原目录</option>
                        <option value="">根目录</option>
                        {folders[selectedKind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
                      </select>
                      <ChevronDown size={14} aria-hidden="true" />
                    </span>
                  </label>
                ) : null}
                {selectedKind === "video" ? (
                  <>
                    <label>
                      <span>视频分类</span>
                      <span className="adminSelectControl">
                        <select name="categoryId" defaultValue="__keep__">
                          <option value="__keep__">保持原分类</option>
                          <option value="">未分类</option>
                          {videoCategories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                        </select>
                        <ChevronDown size={14} aria-hidden="true" />
                      </span>
                    </label>
                    <div className="adminMediaBatchApplyField adminMediaBatchTagField">
                      <label className="adminInlineCheckbox"><input name="applyTags" type="checkbox" />统一标签</label>
                      <VideoTagPicker tags={videoTags} />
                    </div>
                    <label className="adminMediaBatchApplyField">
                      <span><input name="applyVideoPrice" type="checkbox" />统一播放价格</span>
                      <input name="playSodaPrice" type="number" min="0" max="1000000" defaultValue="0" aria-label="24 小时播放所需苏打" />
                    </label>
                    <label className="adminMediaBatchApplyField">
                      <span><input name="applyVideoDownloadPrice" type="checkbox" />统一下载价格</span>
                      <input name="downloadSodaPrice" type="number" min="0" max="1000000" defaultValue="1" aria-label="视频下载所需苏打" />
                    </label>
                    <div className="adminFieldGrid">
                      <label>
                        <span>最新状态</span>
                        <span className="adminSelectControl">
                          <select name="latestAction" defaultValue="keep">
                            <option value="keep">保持不变</option>
                            <option value="mark">设为最新</option>
                            <option value="clear">取消标记</option>
                          </select>
                          <ChevronDown size={14} aria-hidden="true" />
                        </span>
                      </label>
                      <label>
                        <span>标记天数</span>
                        <input name="newDays" type="number" min="1" max="365" defaultValue="14" />
                      </label>
                    </div>
                  </>
                ) : null}
                <footer>
                  <button className="adminSecondaryButton" type="button" onClick={() => setBatchEditing(false)}>取消</button>
                  <button type="submit" disabled={mutation.pending}><Save size={16} aria-hidden="true" />保存</button>
                </footer>
              </>
            ) : null}
          </form>
        </div>
      ) : null}

      {editingAsset ? (
        <div className="adminMediaEditBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingAsset(null)}>
          <form className="adminMediaEditDialog" onSubmit={submitEdit} role="dialog" aria-modal="true" aria-labelledby="admin-media-edit-title" key={editingAsset.id}>
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
            {editingAsset.kind === "audio" ? (
              <label>
                <span>作者</span>
                <input name="artist" defaultValue={editingAsset.artist} maxLength={80} placeholder="可选" />
              </label>
            ) : null}
            {editingAsset.kind === "video" ? (
              <label>
                <span>分类</span>
                <span className="adminSelectControl">
                  <select name="categoryId" defaultValue={editingAsset.categoryId || ""}>
                    <option value="">未分类</option>
                    {videoCategories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.visible ? "" : "（隐藏）"}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
            ) : null}
            <label>
              <span>所在目录</span>
              <span className="adminSelectControl">
                <select name="targetFolder" defaultValue={editingAsset.folder}>
                  <option value="">根目录</option>
                  {folders[editingAsset.kind].map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
            {editingAsset.kind === "video" && videoTags.length ? (
              <div className="adminMediaTagField">
                <span>标签</span>
                <VideoTagPicker tags={videoTags} selectedIds={(visibleTagsByAsset[editingAsset.id] || []).map((tag) => tag.id)} />
              </div>
            ) : null}
            {editingAsset.kind === "video" ? (
              <>
                <label>
                  <span>24 小时播放 / 苏打</span>
                  <input name="playSodaPrice" type="number" min="0" max="1000000" defaultValue={editingAsset.playSodaPrice} />
                </label>
                <label>
                  <span>下载 / 苏打</span>
                  <input name="downloadSodaPrice" type="number" min="0" max="1000000" defaultValue={editingAsset.downloadSodaPrice} />
                </label>
                <div className="adminFieldGrid">
                  <label>
                    <span>最新状态</span>
                    <span className="adminSelectControl">
                      <select name="latestAction" defaultValue="keep">
                        <option value="keep">保持不变</option>
                        <option value="mark">设为最新</option>
                        <option value="clear">取消标记</option>
                      </select>
                      <ChevronDown size={14} aria-hidden="true" />
                    </span>
                  </label>
                  <label>
                    <span>标记天数</span>
                    <input name="newDays" type="number" min="1" max="365" defaultValue="14" />
                  </label>
                </div>
              </>
            ) : null}
            <label>
              <span>简介</span>
              <textarea name="description" defaultValue={editingAsset.description} maxLength={1000} rows={5} />
            </label>
            <footer>
              <button className="adminSecondaryButton" type="button" onClick={() => setEditingAsset(null)}>取消</button>
              <button type="submit" disabled={mutation.pending}><Save size={16} aria-hidden="true" />保存</button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
