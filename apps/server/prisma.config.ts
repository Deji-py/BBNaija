import { defineConfig } from "prisma/config";

// Used by the Prisma CLI (migrations, generate). Paths are relative to apps/server.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "file:./data/house.db" },
});
