import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: ["node_modules/**", "outputs/**", "work/**", ".next/**"]
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }]
  }
});
