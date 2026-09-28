import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/journal/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    include: ["../../tests/journal-ui*.test.tsx"],
    setupFiles: ["src/vitest-setup.ts"],
    css: true
  }
});
