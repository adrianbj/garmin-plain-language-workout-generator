import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup/chromeMocks.ts"],
    passWithNoTests: true,
  },
});
