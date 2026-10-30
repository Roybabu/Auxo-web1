import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Served from https://roybabu.github.io/Auxo-web1/ (GitHub Pages project site), so every asset
// URL needs this prefix. Overridable for other hosts (e.g. a custom domain at the site root).
const base = process.env.VITE_BASE_PATH ?? "/Auxo-web1/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // The app must keep working after an update ships while already installed/offline, so the
      // service worker takes over immediately rather than waiting for all tabs to close.
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // The SQLite WASM binary and worker bundles are large (~1.1 MB combined) but essential —
        // without them cached, the app can't open its database at all when offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,wasm,png,svg,webmanifest}"],
      },
      manifest: {
        name: "Auxo",
        short_name: "Auxo",
        description: "Offline-first point-of-sale for shops and restaurants.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#0a0a0c",
        theme_color: "#0a0a0c",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // @sqlite.org/sqlite-wasm ships its own worker + .wasm asset wiring that Vite's dependency
    // pre-bundler breaks (it rewrites the asset URL the WASM loader expects). Excluding it from
    // pre-bundling is the package's own documented workaround.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: `${rootDir}index.html`,
        // Diagnostic page for the OPFS storage layer; not linked from the app's own nav.
        selftest: `${rootDir}selftest.html`,
      },
    },
  },
});
