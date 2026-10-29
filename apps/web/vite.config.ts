import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
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
