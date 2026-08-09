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
