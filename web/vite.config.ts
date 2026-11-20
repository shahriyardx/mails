/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    // dist/.keep (committed, so `go build` works before the first build)
    // comes back from public/.keep after the clean.
    emptyOutDir: true,
    assetsDir: "assets",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
