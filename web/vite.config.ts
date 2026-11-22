/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app + offline shell. The worker is src/sw.ts; mail data is
    // saved by src/lib/offline.ts. Registered from src/components/app/offline.tsx.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
        // The docs chunk and fonts are big; 4 MB keeps all of them offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: "/",
        name: "Mails",
        short_name: "Mails",
        description: "Your mail, on your own server.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#16151a",
        theme_color: "#16151a",
        icons: [
          { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
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
