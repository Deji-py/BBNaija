# Big Brother Ninja

Lightweight, low-poly, browser-based 3D multiplayer social game + live spectator platform.
_"Big Brother Ninja" is an internal codename only — see [SPEC.md](SPEC.md) §12 on trademarks._

The full build specification lives in [SPEC.md](SPEC.md).

## Status

| Milestone | State |
|---|---|
| M0 — Project setup | ✅ done |
| M1 — Solo house & character | ⏳ next |

## Requirements

- Node.js ≥ 20 (developed on Node 24)
- pnpm 10 — if `pnpm` isn't installed, enable it via corepack without admin rights:

  ```bash
  corepack enable --install-directory ~/.local/bin pnpm
  ```

  (`~/.local/bin` must be on your `PATH`.)

## Setup & run

```bash
pnpm install
pnpm dev
```

This starts both apps in parallel:

| App | URL |
|---|---|
| Client (Vite) | http://localhost:5173 |
| Game server (Colyseus) | ws://localhost:2567 — health check at http://localhost:2567/health |

The client page shows **Game server: online** when it can reach the server.

Other scripts:

```bash
pnpm typecheck   # strict TypeScript check of every package
```

## Layout

```
apps/client      Vite + TypeScript browser client (Three.js arrives in M1)
apps/server      Node + TypeScript + Colyseus authoritative game server
packages/shared  Types and constants shared by client and server (@bbn/shared)
```

`@bbn/shared` is consumed as TypeScript source directly — Vite (client) and tsx (server) compile it on the fly, so there is no build step during development.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `2567` | Port the game server listens on |
| `VITE_SERVER_URL` | client | `http://<page host>:2567` | Override the game server URL |
