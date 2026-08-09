import { initializeMediaLibraryMaintenance } from "./lib/media-maintenance";
import { initializeTelegramIntegration } from "./lib/telegram";

export async function registerNodeInstrumentation() {
  await initializeMediaLibraryMaintenance();
  await initializeTelegramIntegration();
}
