import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Playwright specs live in e2e/ and must not be collected by vitest.
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**", "contracts/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
