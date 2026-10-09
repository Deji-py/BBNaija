# Big Brother Ninja

Lightweight, low-poly, browser-based 3D multiplayer social game + live spectator platform.
_"Big Brother Ninja" is an internal codename only — see [SPEC.md](SPEC.md) §12 on trademarks._

The full build specification lives in [SPEC.md](SPEC.md).

## Status

| Milestone | State |
|---|---|
| M0 — Project setup | ✅ done |
| M1 — Solo house & character | ✅ done |
| M2 — Multiplayer sync | ✅ done |
| M3 — Proximity voice | ⏳ next |

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

Open http://localhost:5173, pick a name and colour, and enter the house. Open a second browser window to see two housemates together.

### Testing multiplayer

```bash
pnpm bots       # 2 bots join the house and wander around (Ctrl+C to stop)
pnpm bots 5     # any number up to the 8-housemate limit
```

**Another machine on the same Wi-Fi:** `pnpm dev` prints a `Network:` URL (e.g. `http://192.168.1.20:5173`). Open it on the other machine — the client connects to the game server on the same host, port 2567. If it can't connect, allow incoming connections for `node` in macOS System Settings → Network → Firewall.

### Controls

| Input | Action |
|---|---|
| W A S D / arrow keys | Move (relative to the camera) |
| Drag with the mouse | Orbit / tilt the camera |
| Q / E | Turn the camera left / right |
| Mouse wheel | Zoom |



Other scripts:

```bash
pnpm typecheck   # strict TypeScript check of every package
```

## Layout

```
apps/client      Vite + TypeScript + Three.js browser client
apps/server      Node + TypeScript + Colyseus authoritative game server
packages/shared  Types and constants shared by client and server (@bbn/shared)
```

Inside `apps/client/src`: `scene/` (renderer, house builder, follow camera), `entities/` (avatar, name tags), `net/` (connection, prediction, interpolation), `input/`, `ui/` (lobby, HUD), `modes/` (the game loop per mode).

Inside `apps/server/src`: `rooms/HouseRoom.ts` (the authoritative room), `schema/` (synced state). `apps/server/scripts/bot.ts` is the bot used by `pnpm bots`.

### How multiplayer works

- **Authoritative server.** Clients only send inputs (`{ seq, dx, dz }`, one per 50 ms step while moving). The server applies them with the shared collision code at 20 Hz and broadcasts positions. A modified client can't teleport or speed up: each player gets one step per tick (with a small burst allowance).
- **Jitter buffer.** Inputs arrive unevenly; the server applies one per tick and only doubles up when a backlog builds, so nobody stutters for everyone else.
- **Client-side prediction** for your own avatar: it moves the instant you press a key; when the server's position arrives, the client re-applies any inputs the server hasn't processed yet. Same code on both sides → corrections are normally zero.
- **Interpolation** for everyone else: remote avatars are drawn 100 ms in the past, blending between the two server snapshots around that time.

The house layout (`packages/shared/src/house.ts`) and the collision/movement code (`packages/shared/src/movement.ts`) live in the shared package so the server can run the exact same rules once it becomes authoritative in M2.

`@bbn/shared` is consumed as TypeScript source directly — Vite (client) and tsx (server) compile it on the fly, so there is no build step during development.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `GAME_SERVER_PORT` | server | `2567` | Port the game server listens on |
| `VITE_SERVER_URL` | client | `http://<page host>:2567` | Override the game server URL |
