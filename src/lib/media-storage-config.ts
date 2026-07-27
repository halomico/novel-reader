export type MediaStorageMode = "local" | "remote";
export type MediaStorageKind = "video" | "audio" | "file";

type MediaDeliveryConfig = {
  publicUrl: string;
  signingSecret: string;
  ttlSeconds: number;
};

export type RemoteMediaNodeConfig = MediaDeliveryConfig & {
  id: string;
  controlUrl: string;
  controlSecret: string;
};

export type RemoteMediaStorageRegistry = {
  nodes: RemoteMediaNodeConfig[];
  routes: Record<MediaStorageKind, string>;
  legacyNodeId: string | null;
};

export class MediaStorageConfigurationError extends Error {}

const MEDIA_KINDS: MediaStorageKind[] = ["video", "audio", "file"];
const MEDIA_NODE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
let cachedRegistry: { key: string; value: RemoteMediaStorageRegistry } | null = null;

function cleanOrigin(value: string | undefined): string | null {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function mediaUrlTtlSeconds(env: NodeJS.ProcessEnv): number {
  const numeric = Number(env.MEDIA_URL_TTL_SECONDS || 21_600);
  return Number.isFinite(numeric)
    ? Math.min(Math.max(Math.floor(numeric), 300), 86_400)
    : 21_600;
}

function configError(message: string): never {
  throw new MediaStorageConfigurationError(message);
}

function parseNode(
  value: unknown,
  ttlSeconds: number,
  position: number,
): RemoteMediaNodeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return configError(`MEDIA_NODES_JSON 第 ${position + 1} 个节点格式无效`);
  }
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const publicUrl = cleanOrigin(typeof source.publicUrl === "string" ? source.publicUrl : undefined);
  const controlUrl = cleanOrigin(typeof source.controlUrl === "string" ? source.controlUrl : undefined);
  const signingSecret = typeof source.signingSecret === "string" ? source.signingSecret : "";
  const controlSecret = typeof source.controlSecret === "string" ? source.controlSecret : "";
  if (!MEDIA_NODE_ID_PATTERN.test(id)) {
    return configError("媒体节点 id 只能使用小写字母、数字、下划线和连字符，长度不超过 32");
  }
  if (!publicUrl || signingSecret.length < 32) {
    return configError(`媒体节点 ${id} 需要合法的 publicUrl 和至少 32 字符的 signingSecret`);
  }
  if (!controlUrl || controlSecret.length < 32) {
    return configError(`媒体节点 ${id} 需要合法的 controlUrl 和至少 32 字符的 controlSecret`);
  }
  return { id, publicUrl, controlUrl, signingSecret, controlSecret, ttlSeconds };
}

function legacyNode(env: NodeJS.ProcessEnv, ttlSeconds: number): RemoteMediaNodeConfig {
  return parseNode({
    id: "default",
    publicUrl: env.MEDIA_PUBLIC_URL,
    controlUrl: env.MEDIA_CONTROL_URL,
    signingSecret: env.MEDIA_SIGNING_SECRET,
    controlSecret: env.MEDIA_CONTROL_SECRET,
  }, ttlSeconds, 0);
}

function registryCacheKey(env: NodeJS.ProcessEnv): string {
  return [
    env.MEDIA_STORAGE_MODE,
    env.MEDIA_NODES_JSON,
    env.MEDIA_NODE_ROUTES_JSON,
    env.MEDIA_LEGACY_NODE_ID,
    env.MEDIA_PUBLIC_URL,
    env.MEDIA_CONTROL_URL,
    env.MEDIA_SIGNING_SECRET,
    env.MEDIA_CONTROL_SECRET,
    env.MEDIA_URL_TTL_SECONDS,
  ].join("\u0000");
}

function parseRoutes(
  env: NodeJS.ProcessEnv,
  nodes: RemoteMediaNodeConfig[],
): Record<MediaStorageKind, string> {
  const knownIds = new Set(nodes.map((node) => node.id));
  const onlyNodeId = nodes.length === 1 ? nodes[0].id : null;
  let source: Record<string, unknown> = {};
  if ((env.MEDIA_NODE_ROUTES_JSON || "").trim()) {
    try {
      const parsed = JSON.parse(env.MEDIA_NODE_ROUTES_JSON || "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return configError("MEDIA_NODE_ROUTES_JSON 必须是 JSON 对象");
      }
      source = parsed as Record<string, unknown>;
    } catch {
      return configError("MEDIA_NODE_ROUTES_JSON 不是有效的 JSON");
    }
  } else if (!onlyNodeId) {
    return configError("配置多个媒体节点时必须设置 MEDIA_NODE_ROUTES_JSON");
  }

  return Object.fromEntries(MEDIA_KINDS.map((kind) => {
    const nodeId = typeof source[kind] === "string" && source[kind]
      ? String(source[kind]).trim()
      : onlyNodeId;
    if (!nodeId || !knownIds.has(nodeId)) {
      return configError(`媒体类型 ${kind} 没有指向已配置的节点`);
    }
    return [kind, nodeId];
  })) as Record<MediaStorageKind, string>;
}

export function getMediaStorageMode(env: NodeJS.ProcessEnv = process.env): MediaStorageMode {
  const value = (env.MEDIA_STORAGE_MODE || "local").trim().toLowerCase();
  if (value === "local" || value === "remote") {
    return value;
  }
  throw new MediaStorageConfigurationError("MEDIA_STORAGE_MODE 只能是 local 或 remote");
}

export function isRemoteMediaStorage(env: NodeJS.ProcessEnv = process.env): boolean {
  return getMediaStorageMode(env) === "remote";
}

export function getRemoteMediaStorageRegistry(
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaStorageRegistry {
  if (getMediaStorageMode(env) !== "remote") {
    throw new MediaStorageConfigurationError("远程媒体存储未启用");
  }
  const cacheKey = registryCacheKey(env);
  if (env === process.env && cachedRegistry?.key === cacheKey) {
    return cachedRegistry.value;
  }

  const ttlSeconds = mediaUrlTtlSeconds(env);
  let nodes: RemoteMediaNodeConfig[];
  const serializedNodes = (env.MEDIA_NODES_JSON || "").trim();
  if (serializedNodes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedNodes);
    } catch {
      return configError("MEDIA_NODES_JSON 不是有效的 JSON");
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      return configError("MEDIA_NODES_JSON 至少需要一个节点");
    }
    nodes = parsed.map((node, index) => parseNode(node, ttlSeconds, index));
  } else {
    nodes = [legacyNode(env, ttlSeconds)];
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      return configError(`媒体节点 id 重复：${node.id}`);
    }
    nodeIds.add(node.id);
  }
  const routes = parseRoutes(env, nodes);
  const configuredLegacyNodeId = (env.MEDIA_LEGACY_NODE_ID || "").trim();
  const legacyNodeId = configuredLegacyNodeId || (nodes.length === 1 ? nodes[0].id : null);
  if (legacyNodeId && !nodeIds.has(legacyNodeId)) {
    return configError("MEDIA_LEGACY_NODE_ID 必须指向已配置的媒体节点");
  }
  const registry = { nodes, routes, legacyNodeId };
  if (env === process.env) {
    cachedRegistry = { key: cacheKey, value: registry };
  }
  return registry;
}

export function listRemoteMediaNodes(
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaNodeConfig[] {
  return getRemoteMediaStorageRegistry(env).nodes;
}

export function getRemoteMediaNodeConfig(
  nodeId: string,
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaNodeConfig {
  const normalizedNodeId = nodeId.trim();
  const node = getRemoteMediaStorageRegistry(env).nodes.find((item) => item.id === normalizedNodeId);
  if (!node) {
    throw new MediaStorageConfigurationError(`媒体节点 ${normalizedNodeId || "(empty)"} 未配置`);
  }
  return node;
}

export function getRemoteMediaNodeForKind(
  kind: MediaStorageKind,
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaNodeConfig {
  const registry = getRemoteMediaStorageRegistry(env);
  return getRemoteMediaNodeConfig(registry.routes[kind], env);
}

export function resolveRemoteMediaNodeForAsset(
  storageNodeId: string | null | undefined,
  kind: MediaStorageKind,
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaNodeConfig {
  const registry = getRemoteMediaStorageRegistry(env);
  return getRemoteMediaNodeConfig(
    storageNodeId || registry.legacyNodeId || registry.routes[kind],
    env,
  );
}

export function getRemoteMediaStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): RemoteMediaNodeConfig {
  const registry = getRemoteMediaStorageRegistry(env);
  const nodeId = registry.legacyNodeId || (registry.nodes.length === 1 ? registry.nodes[0].id : "");
  if (!nodeId) {
    throw new MediaStorageConfigurationError("多个媒体节点之间没有默认节点，请按资源类型或节点 id 选择");
  }
  return getRemoteMediaNodeConfig(nodeId, env);
}

export function getMediaPublicUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (getMediaStorageMode(env) !== "remote") return null;
  const registry = getRemoteMediaStorageRegistry(env);
  return getRemoteMediaNodeConfig(
    registry.legacyNodeId || registry.routes.video,
    env,
  ).publicUrl;
}

export function remoteMediaRegistryFingerprint(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const registry = getRemoteMediaStorageRegistry(env);
  return JSON.stringify({
    nodes: registry.nodes.map((node) => [node.id, node.controlUrl]),
    routes: registry.routes,
  });
}
