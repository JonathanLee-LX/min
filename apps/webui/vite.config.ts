import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.MIN_WEB_API ?? "http://127.0.0.1:43127";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    port: 43128,
    proxy: {
      "/api": API,
      "/events": API,
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
});
