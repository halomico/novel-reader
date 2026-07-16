import { initializeMediaLibraryMaintenance } from "./lib/media-maintenance";

export async function registerNodeInstrumentation() {
  await initializeMediaLibraryMaintenance();
}
