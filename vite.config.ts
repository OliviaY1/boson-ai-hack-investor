import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/ws": { target: api.replace("http", "ws"), ws: true },
    },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
