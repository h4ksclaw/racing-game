import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@client": resolve(__dirname, "src/client"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // No global setup — tests load .env themselves
  },
});
