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
| M3 — Proximity voice | ✅ done |
| M4 — Chat, emotes & interactions | ✅ done |
| M5 — Spectator mode | ✅ done |
| M6 — Big Brother console, tasks & Diary Room | ⏳ next |

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
| Game server (Colyseus) | port 2567 — the client reaches it through Vite at `/colyseus`; health check at http://localhost:2567/health |

Open http://localhost:5173, pick a name and colour, and enter the house. Open a second browser window to see two housemates together.

### Watching (spectator mode)

Open **http://localhost:5173/watch** and click **Start watching**. Viewers have no avatar — they render the live house from game state (no video stream), so watching is cheap.

| Input | Action |
|---|---|
| 1–6 or the camera bar | House cameras: Lounge, Kitchen, Bedroom, Gym, Garden, Diary Room |
| Click a housemate in the list | Follow them (drag to look around; the camera swings back behind them after 3 s) |
| 0 | Free camera: WASD fly, drag to look, Q / E down / up, Shift faster |
| Emoji buttons | Reactions that float up for every viewer |
| Enter | Viewer chat |

- **Audio follows the camera** — you hear what that spot would hear (voices fade out by 15 m). The first **10** viewers get live audio; in the peer-to-peer MVP every listening viewer adds an upload stream for each housemate, so the cap protects housemates' connections until LiveKit (M9).
- **The bubble stays intact:** viewer chat, reactions and the viewer list are only ever sent to viewers. Viewers *can* read house chat, as on the real show.
- Housemates and viewers share one room: up to 8 housemates plus 100 viewers.



```bash
pnpm bots       # 2 bots join the house and wander around (Ctrl+C to stop)
pnpm bots 5     # any number up to the 8-housemate limit
```

**Another machine on the same Wi-Fi:** `pnpm dev` prints a `Network:` URL (e.g. `http://192.168.1.20:5173`). Open it on the other machine. If it can't connect, allow incoming connections for `node` in macOS System Settings → Network → Firewall. Over plain `http://` the other machine can move and **listen**, but browsers won't give it a microphone — use a tunnel (below) to talk.

### Voice

Proximity voice: housemates hear each other louder the closer they are (full volume within 1.5 m, silent beyond 15 m), panned left/right relative to your camera. Walls don't block sound yet.

| Input | Action |
|---|---|
| M or the **Mute** button | Mute / unmute |
| **Open mic / Push-to-talk** button | Switch mode |
| Hold V | Talk (push-to-talk mode) |

The browser asks for microphone access when you click **Enter the house**. If you decline (or have no mic), you can still listen. A green badge above a head means that person is talking; red means muted.

**Testing voice across machines (HTTPS tunnel).** Browsers only allow the microphone on `https://` or `http://localhost`. A free Cloudflare quick tunnel gives your dev server an HTTPS URL that works anywhere:

```bash
brew install cloudflared                       # once
cloudflared tunnel --url http://localhost:5173  # while pnpm dev is running
```

It prints a `https://<random>.trycloudflare.com` URL — open that on every machine (including your own). The game server traffic goes through the same URL (Vite proxies `/colyseus` to port 2567), so nothing else needs exposing. Anyone with the URL can join, so only share it with testers. `ngrok http 5173` works too.

**Testing voice on one machine:** open `http://localhost:5173/?fakeMic` in two windows. In development, `?fakeMic` sends a 440 Hz test tone instead of your microphone, so you can hear the distance falloff without feedback. Use headphones.

### Controls

| Input | Action |
|---|---|
| W A S D / arrow keys | Move (relative to the camera) |
| Drag with the mouse | Orbit / tilt the camera |
| Z / C | Turn the camera left / right |
| Mouse wheel | Zoom |
| E | Use the object you're next to (a prompt appears) — or get up again |
| 1 / 2 | Wave / dance (2 again, or moving, stops dancing) |
| Enter | Chat (Enter sends, Esc cancels) |

**Things to use:** sofa (3 seats), Diary Room chair, beds (sleep), stove (cook), treadmills (run), pool (swim, up to 6), and the TV (on/off for everyone). Walking away gets you up automatically.

**Chat:** house-wide, max 280 characters, up to 3 messages in a burst then one every 1.5 s. Messages show in the panel and as a bubble over the sender's head; people who join later see the last 50.



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

Inside `apps/client/src`: `scene/` (renderer, house builder, follow & spectator cameras), `entities/` (avatar, name tags, voice badges), `net/` (connection, prediction, interpolation), `voice/` (VoiceProvider interface, WebRTC mesh, spatial audio, mic), `input/`, `ui/` (lobby, HUD, voice controls), `modes/` (`housemate.ts`, `spectator.ts`, and `playersView.ts` which draws everyone from server state for both).

Inside `apps/server/src`: `rooms/HouseRoom.ts` (the authoritative room), `schema/` (synced state), `systems/` (chat log, rate limiting).

Interactable objects (seats, exit spots, ranges) are defined in `packages/shared/src/interactions.ts`, next to the house layout. `apps/server/scripts/bot.ts` is the bot used by `pnpm bots`.

### How multiplayer works

- **Authoritative server.** Clients only send inputs (`{ seq, dx, dz }`, one per 50 ms step while moving). The server applies them with the shared collision code at 20 Hz and broadcasts positions. A modified client can't teleport or speed up: each player gets one step per tick (with a small burst allowance).
- **Jitter buffer.** Inputs arrive unevenly; the server applies one per tick and only doubles up when a backlog builds, so nobody stutters for everyone else.
- **Client-side prediction** for your own avatar: it moves the instant you press a key; when the server's position arrives, the client re-applies any inputs the server hasn't processed yet. Same code on both sides → corrections are normally zero.
- **Interpolation** for everyone else: remote avatars are drawn 100 ms in the past, blending between the two server snapshots around that time.

### How voice works

- **Peer-to-peer mesh (WebRTC).** Each housemate's browser holds a direct audio connection to every other housemate; audio never touches our server. The server only relays the one-off connection setup (an *offer* and an *answer*, via `voice:signal`). Fine up to ~8 people; M9 swaps in LiveKit behind the same `VoiceProvider` interface.
- **Spatial audio.** Each incoming voice runs through a Web Audio `PannerNode` placed at that housemate's head; the listener sits at your head facing the camera direction.
- **Mute / push-to-talk** just disable the outgoing mic track, so they take effect in ~0.1 s with no reconnection.
- A public STUN server (Google's) helps peers on different networks find each other. Some strict networks (corporate, some mobile carriers) also need a TURN relay — planned for M9.

The house layout (`packages/shared/src/house.ts`) and the collision/movement code (`packages/shared/src/movement.ts`) live in the shared package so the server can run the exact same rules once it becomes authoritative in M2.

`@bbn/shared` is consumed as TypeScript source directly — Vite (client) and tsx (server) compile it on the fly, so there is no build step during development.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `GAME_SERVER_PORT` | server, Vite proxy | `2567` | Port the game server listens on |
| `VITE_SERVER_URL` | client | `<page origin>/colyseus` | Override the game server URL |
