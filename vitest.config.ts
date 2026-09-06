import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // lib/ only. These suites cover the arithmetic and the rules — the things
    // that must be right rather than merely look right — and none of them
    // touch the database or React. The end-to-end flows are covered by the
    // scripts/qa-*.ts harnesses, which do use a real database.
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
