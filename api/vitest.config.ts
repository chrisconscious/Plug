import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    // Every route.ts file imports via the "@/lib/..." path alias (see
    // tsconfig.json's "paths"). Vitest does not read tsconfig paths on its
    // own — without this, any test that imports a real route module (as
    // opposed to only testing lib/ files directly via relative imports,
    // which is all that existed before this) fails to resolve those
    // imports at all.
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
