import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma no longer reads `.env` by itself when a config file is present, and a
// migration run against an undefined DATABASE_URL fails with a message that
// does not mention the environment at all.
//
// LOCAL ONLY. On Vercel the variables come from the platform, and reading a
// .env file there is never right: dotenv fills in anything the platform has
// not set, so a stray .env turns a missing DATABASE_URL into a silent
// connection to whatever that file happens to name. This build failed once
// with "Can't reach database server at localhost:5432" for exactly that
// reason, which was the harmless version of the mistake.
if (!process.env.VERCEL) {
  await import("dotenv/config");
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
