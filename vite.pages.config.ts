import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/RCM-Genco/",
  root: projectRoot,
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "pages-dist",
    rollupOptions: {
      input: fileURLToPath(new URL("index.html", import.meta.url)),
    },
  },
});
