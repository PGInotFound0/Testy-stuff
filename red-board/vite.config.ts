import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  server: {
    // In local dev the Express server mounts Vite as middleware,
    // so this is only a fallback if `vite` is run standalone.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
