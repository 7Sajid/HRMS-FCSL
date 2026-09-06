import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same alias as tsconfig, so a module can be imported the same way in a
    // test as in the app and nobody has to remember two spellings.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    // The arithmetic and the rules — the things that must be right rather than
    // merely look right — and none of them touch the database or render React.
    // End-to-end flows are covered by scripts/qa-*.ts against a real database.
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    environment: "node",
  },
});
