#!/bin/sh
# Boot against PostgreSQL: regenerate the Prisma client for Postgres, create any
# missing tables (refuses if that would drop data), then start the game server.
set -e
cd "$(dirname "$0")/.."
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required (postgres://...)" >&2
  exit 1
fi
pnpm exec prisma generate --config prisma.postgres.config.ts
pnpm exec prisma db push --config prisma.postgres.config.ts
exec pnpm exec tsx src/index.ts
