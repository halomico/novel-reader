import "dotenv/config";

import path from "node:path";
import { createMediaNodeServer } from "../src/lib/media-node-server";

function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_NODE_DIR || process.env.MEDIA_DIR || "./data/media");
}

const signingSecret = process.env.MEDIA_SIGNING_SECRET || "";
const controlSecret = process.env.MEDIA_CONTROL_SECRET || "";
const server = createMediaNodeServer({
  root: mediaRoot(),
  signingSecret,
  controlSecret,
  maxVideoStreams: Number(process.env.MEDIA_NODE_MAX_VIDEO_STREAMS || 0),
  videoBandwidthMbps: Number(process.env.MEDIA_NODE_VIDEO_BANDWIDTH_MBPS || 0),
});

const configuredPort = Number(process.env.MEDIA_NODE_PORT || 3100);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
  ? configuredPort
  : 3100;
server.listen(port, "0.0.0.0", () => {
  console.info(`[media-node] listening on :${port}`);
});

let draining = false;
function shutdown(signal: "SIGINT" | "SIGTERM"): void {
  if (draining) return;
  draining = true;
  console.info(`[media-node] draining after ${signal}`);
  const timeout = setTimeout(() => {
    console.error("[media-node] graceful shutdown timed out");
    process.exitCode = 1;
    server.closeAllConnections();
  }, 30_000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      console.error("[media-node] graceful shutdown failed", error);
      process.exitCode = 1;
      return;
    }
    console.info("[media-node] stopped");
  });
  server.closeIdleConnections();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
