# One production service: build the browser client, then serve it from the game server.
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/client apps/client
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bbn/client build
WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 10000
CMD ["sh", "scripts/start-postgres.sh"]
