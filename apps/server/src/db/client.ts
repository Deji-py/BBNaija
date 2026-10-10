import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * One database client. Local development uses SQLite. A `postgres://` or
 * `postgresql://` DATABASE_URL uses Postgres — the production image generates
 * the Postgres Prisma client before booting (the client generated here is SQLite).
 */
const url = process.env.DATABASE_URL ?? "file:./data/house.db";
const postgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

export const db = new PrismaClient({
  adapter: postgres ? new PrismaPg(url) : new PrismaBetterSqlite3({ url }),
});
