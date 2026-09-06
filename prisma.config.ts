import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma no longer reads `.env` by itself when a config file is present, and a
// migration run against an undefined DATABASE_URL fails with a message that
// does not mention the environment at all.
import "dotenv/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
