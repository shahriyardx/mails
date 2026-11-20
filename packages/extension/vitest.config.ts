import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The "@/" alias WXT gives the app code, for tests of entrypoints.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
