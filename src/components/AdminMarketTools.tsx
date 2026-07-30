"use client";

import { Check, Copy, FileText, ImagePlus, TicketPlus, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, FormEvent, useRef, useState, useTransition } from "react";
import { createRedemptionCodeBatchAction } from "@/app/admin/market/actions";
import type { MarketAsset } from "@/lib/market";
import { AdminSelect } from "./AdminSelect";

type ProductOption = { id: number; title: string };

type UploadStart = {
  ok?: boolean;
  message?: string;
  uploadId?: string;
  uploadUrl?: string;
  uploadToken?: string;
  chunkBytes?: number;
  asset?: MarketAsset;
};

type CoverResponse = {
  ok?: boolean;
  message?: string;
  coverKey?: string;
};

async function responseJson(response: Response): Promise<UploadStart & { nextOffset?: number }> {
  try {
    return await response.json() as UploadStart & { nextOffset?: number };
  } catch {
    return { message: "服务器返回了无效响应" };
  }
}

function uploadHeaders(token: string | undefined, offset?: number): HeadersInit {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(offset == null ? {} : { "X-Upload-Offset": String(offset) }),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function AdminMarketFilePicker({
  productId,
  assets: initialAssets = [],
  selectedAssetId,
  onAssetUploaded,
}: {
  productId: number;
  assets?: MarketAsset[];
  selectedAssetId: number | null;
  onAssetUploaded?: (asset: MarketAsset) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState(initialAssets);
  const [selectedId, setSelectedId] = useState(
    selectedAssetId
      ? String(selectedAssetId)
      : initialAssets.length === 1
        ? String(initialAssets[0].id)
        : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] || null;
    setFile(next);
    setMessage(next ? next.name : "");
    setProgress(0);
  }

  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setMessage("正在准备上传");
    let uploadId = "";
    try {
      const startResponse = await fetch("/admin/market/upload?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      const started = await responseJson(startResponse);
      if (!startResponse.ok || !started.uploadId || !started.uploadUrl || !started.chunkBytes) {
        throw new Error(started.message || "无法创建上传任务");
      }
      uploadId = started.uploadId;
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, Math.min(offset + started.chunkBytes, file.size));
        const response = await fetch(started.uploadUrl, {
          method: "POST",
          headers: uploadHeaders(started.uploadToken, offset),
          body: chunk,
        });
        const body = await responseJson(response);
        if (!response.ok || !body.nextOffset || body.nextOffset <= offset) {
          throw new Error(body.message || "文件分片上传失败");
        }
        offset = body.nextOffset;
        setProgress(Math.round((offset / file.size) * 100));
        setMessage(`正在上传 ${Math.round((offset / file.size) * 100)}%`);
      }
      const finishResponse = await fetch(`/admin/market/upload?action=finish&uploadId=${encodeURIComponent(uploadId)}`, {
        method: "POST",
      });
      const finished = await responseJson(finishResponse);
      if (!finishResponse.ok) throw new Error(finished.message || "文件保存失败");
      setFile(null);
      setMessage("文件已上传");
      setProgress(100);
      if (inputRef.current) inputRef.current.value = "";
      if (finished.asset) {
        setAssets((current) => [finished.asset!, ...current.filter((asset) => asset.id !== finished.asset!.id)]);
        setSelectedId(String(finished.asset.id));
        onAssetUploaded?.(finished.asset);
      }
    } catch (error) {
      if (uploadId) void fetch(`/admin/market/upload?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  const selectedAsset = assets.find((asset) => String(asset.id) === selectedId) || null;

  return (
    <div className="adminMarketFilePicker">
      {assets.length > 1 ? (
        <label>
          <span>交付文件</span>
          <AdminSelect
            name="marketAssetId"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            required
          >
            <option value="">选择文件</option>
            {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.fileName}</option>)}
          </AdminSelect>
        </label>
      ) : <input type="hidden" name="marketAssetId" value={selectedId} />}
      {selectedAsset ? (
        <div className="adminMarketSelectedFile">
          <FileText size={16} aria-hidden="true" />
          <span><strong>{selectedAsset.fileName}</strong><small>{formatBytes(selectedAsset.sizeBytes)}</small></span>
        </div>
      ) : null}
      <div className="adminMarketFileUpload">
        <input ref={inputRef} type="file" onChange={choose} disabled={busy} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={15} aria-hidden="true" />选择新文件
        </button>
        <button type="button" onClick={upload} disabled={!file || busy}>上传</button>
        <span>{message || "上传后自动选中"}</span>
      </div>
      {busy || progress > 0 ? <progress max="100" value={progress} aria-label="上传进度" /> : null}
    </div>
  );
}

export function AdminMarketCoverUploader({
  productId,
  initialCoverKey,
}: {
  productId: number;
  initialCoverKey: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [coverKey, setCoverKey] = useState(initialCoverKey);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setMessage("正在处理封面");
    try {
      const body = new FormData();
      body.set("cover", file);
      const response = await fetch(`/admin/market/${productId}/cover`, {
        method: "POST",
        body,
      });
      const result = await response.json() as CoverResponse;
      if (!response.ok || !result.coverKey) {
        throw new Error(result.message || "封面上传失败");
      }
      setCoverKey(result.coverKey);
      setFile(null);
      setMessage(result.message || "封面已更新");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "封面上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!coverKey || busy || !window.confirm("删除当前商品封面？")) return;
    setBusy(true);
    try {
      const response = await fetch(`/admin/market/${productId}/cover`, { method: "DELETE" });
      const result = await response.json() as CoverResponse;
      if (!response.ok) throw new Error(result.message || "封面删除失败");
      setCoverKey(null);
      setFile(null);
      setMessage(result.message || "封面已删除");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "封面删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="adminMarketCoverEditor" onSubmit={submit}>
      <div className="adminMarketCoverPreview">
        {coverKey ? (
          <Image
            src={`/market/cover/${productId}?v=${encodeURIComponent(coverKey)}`}
            alt=""
            width={320}
            height={180}
            unoptimized
          />
        ) : <ImagePlus size={24} aria-hidden="true" />}
      </div>
      <div className="adminMarketCoverControls">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const next = event.target.files?.[0] || null;
            setFile(next);
            setMessage(next?.name || "");
          }}
          disabled={busy}
        />
        <div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <ImagePlus size={15} aria-hidden="true" />选择封面
          </button>
          <button type="submit" disabled={!file || busy}>上传</button>
          {coverKey ? (
            <button className="isDanger" type="button" onClick={remove} disabled={busy} title="删除封面" aria-label="删除封面">
              <Trash2 size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <small>{message || "JPG、PNG 或 WebP，自动裁切为 16:9"}</small>
      </div>
    </form>
  );
}

export function AdminRedemptionCodeGenerator({ products }: { products: ProductOption[] }) {
  const [pending, startTransition] = useTransition();
  const [rewardType, setRewardType] = useState<"cookie" | "soda" | "product">("cookie");
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage("");
    setCodes([]);
    startTransition(async () => {
      const result = await createRedemptionCodeBatchAction({
        name: String(data.get("name") || ""),
        rewardType,
        rewardAmount: Number(data.get("rewardAmount")),
        productId: Number(data.get("productId")) || null,
        count: Number(data.get("count")),
        expiresAt: String(data.get("expiresAt") || ""),
      });
      if (result.ok) {
        setCodes(result.codes);
        setMessage(`已生成 ${result.codes.length} 个兑换码，仅在这里显示一次。`);
      } else {
        setMessage(result.message);
      }
    });
  }

  async function copy() {
    if (!codes.length) return;
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="adminMarketCodeTool">
      <form onSubmit={submit}>
        <label><span>批次</span><input name="name" maxLength={100} required /></label>
        <label>
          <span>兑换内容</span>
          <select value={rewardType} onChange={(event) => setRewardType(event.target.value as typeof rewardType)}>
            <option value="cookie">曲奇</option>
            <option value="soda">苏打</option>
            <option value="product">商品</option>
          </select>
        </label>
        {rewardType === "product" ? (
          <label>
            <span>商品</span>
            <select name="productId" required>
              <option value="">请选择</option>
              {products.map((product) => <option value={product.id} key={product.id}>{product.title}</option>)}
            </select>
          </label>
        ) : (
          <label><span>面额</span><input name="rewardAmount" type="number" min="1" max="2000000000" required /></label>
        )}
        <label><span>数量</span><input name="count" type="number" min="1" max="5000" defaultValue="10" required /></label>
        <label><span>有效期</span><input name="expiresAt" type="datetime-local" /></label>
        <button type="submit" disabled={pending}><TicketPlus size={15} aria-hidden="true" />生成</button>
      </form>
      {message ? <p>{message}</p> : null}
      {codes.length ? (
        <div className="adminMarketCodeOutput">
          <textarea readOnly value={codes.join("\n")} rows={Math.min(codes.length + 1, 12)} />
          <button type="button" onClick={copy}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? "已复制" : "复制全部"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
