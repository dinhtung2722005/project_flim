import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
const project = fileURLToPath(new URL("../../", import.meta.url));
config({ path: project + ".env.web.local", quiet: true });
const apiTarget = process.env.WEB_API_ORIGIN || "http://127.0.0.1:3000";
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_CLOUDINARY_CLOUD_NAME": JSON.stringify(
      process.env.VITE_CLOUDINARY_CLOUD_NAME || "",
    ),
  },
  build: { outDir: "../../dist/web", emptyOutDir: true, sourcemap: false },
  server: {
    host: "127.0.0.1",
    port: 3002,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    host: "127.0.0.1",
    port: 3002,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
