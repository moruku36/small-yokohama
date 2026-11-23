import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@small-yokohama/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "tools/*/src/**/*.test.ts",
      "viewer/src/**/*.test.ts",
    ],
  },
});
