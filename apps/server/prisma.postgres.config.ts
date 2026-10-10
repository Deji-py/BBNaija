import { defineConfig } from "prisma/config";

// Production only. Generates a Postgres client into the same output path as the
// SQLite schema, then `db push` creates tables. Do not run this against the local SQLite file.
export default defineConfig({
  schema: "prisma/schema.postgres.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
