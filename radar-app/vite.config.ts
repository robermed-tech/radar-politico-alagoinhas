import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5180 },
  // Vercel usa "/" (default). GitHub Pages legado usava "/radar-politico-alagoinhas/".
  base: "/",
  build: {
    rollupOptions: {
      output: {
        // Vendors em chunks próprios — ECharts (pesado) sai do bundle inicial
        // e fica cacheado entre navegações.
        manualChunks: {
          echarts: ["echarts", "echarts-for-react"],
          "react-vendor": ["react", "react-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
