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
| M6 — Big Brother console, tasks & Diary Room | ✅ done |
| M7 — Accounts, seasons & applications | ✅ done |
| M8 — Nominations, voting & evictions | ✅ done |
| M9 — LiveKit, deploy, payments & analytics | ✅ done (public URL needs your host, LiveKit, and Paystack keys) |

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

`pnpm install` also builds the database client; `pnpm dev` applies any pending database migrations (a local SQLite file at `apps/server/data/house.db`) and starts both apps in parallel:

| App | URL |
|---|---|
| Client (Vite) | http://localhost:5173 |
| Game server (Colyseus) | port 2567 — the client reaches it through Vite at `/colyseus`; health check at http://localhost:2567/health |

### Running a season (accounts, applications, selection)

Only **selected housemates of the live season** can enter the house. To try the whole flow locally:

1. Open **http://localhost:5173/bigbrother** (secret: see below) → **Season & applicants** tab → create a season and set it to **Taking applications**.
2. Open **http://localhost:5173** → **Apply now** → sign in with any email. In development no email is sent: the sign-in link appears on the page (and in the server log) — click it.
3. Fill in the application (18+ and all three consents are required). Use a second browser profile or a private window to sign in as someone else.
4. In the console, **Select** applicants (up to the season's max), then set the season to **Live**.
5. Selected housemates now see **Enter the house** on the landing page (`/house`). Everyone else can watch at `/watch` — no account needed; signing in just sets your viewer-chat name.

Sign-in links work once, for 15 minutes; sessions last 30 days. Only one season can be taking applications or live at a time. ⚠️ Because development shows sign-in links on screen, **anyone who can reach your dev server can sign in as any email** — don't expose it publicly for long. Production refuses to show links and still needs an email provider before a public launch.

**Testing with bots:** `pnpm bots` still works without accounts — in development, bots present the admin secret and are admitted as test housemates (never in production).

**Database tools:** `pnpm --filter @bbn/server db:studio` opens Prisma Studio to browse/edit data; `db:migrate` creates a migration after changing `apps/server/prisma/schema.prisma`. To start completely fresh, stop the server and delete `apps/server/data/`.

### Watching (spectator mode)

Open **http://localhost:5173/watch** and click **Start watching**. Viewers have no avatar — they render the live house from game state (no video stream), so watching is cheap.

| Input | Action |
|---|---|
| 1–6 or the camera bar | House cameras: Lounge, Kitchen, Bedroom, Gym, Garden, Diary Room |
| Click a housemate in the list | Follow them (drag to look around; the camera swings back behind them after 3 s) |
| 0 | Free camera: WASD fly, drag to look, Q / E down / up, Shift faster |
| Emoji buttons | Reactions that float up for every viewer |
| Enter | Viewer chat |

- **Audio follows the camera** — you hear what that spot would hear (voices fade out by 15 m). With the peer-to-peer mesh, the first **10** viewers get live audio (each one adds an upload for every housemate). When LiveKit is configured, viewers don't use those mesh slots.
- **The bubble stays intact:** viewer chat, reactions and the viewer list are only ever sent to viewers. Viewers *can* read house chat, as on the real show.
- Housemates and viewers share one room: up to 8 housemates plus 100 viewers.

### Big Brother console

Open **http://localhost:5173/bigbrother** and enter the admin secret. Two tabs: **Live** (everything below) and **Season & applicants** (create seasons, open applications, go live, review and select applicants). Set it in `apps/server/.env` (copy `apps/server/.env.example`):

```bash
cp apps/server/.env.example apps/server/.env
```

Then edit `ADMIN_SECRET` in that file. Without a `.env`, development uses the secret **`bigbrother`** (the server logs a warning); production refuses to start without `ADMIN_SECRET`. One console at a time — opening it again takes over.

| Control | What it does |
|---|---|
| Hold **T** / “Diary Room” button | Talk to the housemate in the Diary Room only |
| Hold **B** / “whole house” button | Talk to every housemate (they see “Big Brother is speaking”) |
| Announcement | Red banner for housemates *and* viewers, also posted in house chat |
| **Diary** (per housemate) | Teleports them into the Diary Room chair and starts a private session |
| End session / Broadcast to viewers | Release them; choose whether viewers can watch & hear (default: broadcast) |
| **Mute** / **Kick** | Mute blocks their voice and house chat; kick removes them from the house |
| Tasks | Start a task with a reward; the top scorer(s) win it |
| Event log | Everything that happened — saved to the database, reloaded on restart |
| 1–6, 0, click a name | Cameras, free cam, follow — as on /watch |

Talking stops automatically if the console window loses focus, so you can't stay on air by accident.

**Diary Room privacy.** Voice is peer-to-peer, so each client enforces the same rule (`packages/shared/src/voicePolicy.ts`) in both directions: it doesn't send its mic to anyone who mustn't hear it, and doesn't play anyone it mustn't hear. During a session the housemate is heard only by Big Brother (and viewers, if broadcast) and can't hear the house; they stay in the chair until released, and their house chat and emotes are paused. New voice links start silent until these rules allow them.

**Tasks**

| Task | How to play | Ends |
|---|---|---|
| Cooking challenge | Fridge (E) → counter (E) → cook at the stove for 4 s = 1 dish | after 3 min |
| Treasure hunt | 6 glowing gems hidden around the house — walk up, press E | 3 min, or when all are found |
| Quiz | 5 multiple-choice questions, 15 s each; first answer is final | after question 5 |

Rewards: 🛡️ Immunity, ⭐ Extra nomination power (both used in the ceremony below), 👑 Golden crown (worn on the avatar). Ties share the reward. Rewards are saved on the housemate, so they survive leaving and coming back.

### Nominations, voting & eviction

Big Brother runs this from the **Live** tab. The server is the referee: browsers only send "I nominate these people" or "I vote for this person". Vote totals are kept on the server until the reveal — they are not part of the live state everyone receives, so nobody can peek.

You need **at least 3 housemates in the house** to nominate (with the final 2, use **Finale vote** instead). Immunity means that person cannot be nominated, and it is used up when the nominees are locked. Extra nomination power means that housemate must name **two** people; using it spends the perk.

| Step | What happens |
|---|---|
| **Start nominations** | The Diary Room goes private. Call each housemate in with **Diary**. They pick who should face the vote. Other housemates never see the picks. |
| **Close nominations** | The two most-nominated face the public vote. A tie for the last place puts everyone on that number up. If fewer than two were named, use **Nominate …** to fill the slate. |
| **Open voting** | 1, 3 or 5 minutes. Signed-in viewers each get **one vote to save** someone. Fewest votes leaves. Housemates cannot vote. |
| **Close voting**, then **Reveal result** | Totals appear for everyone. The evicted housemate walks out through the garden and becomes a viewer — they can watch, but they can't re-enter. A tie makes you choose who leaves. |
| **Finale vote** | With the last two (or more) still in the house. Viewers vote for the **winner** (most votes). The winner screen comes up; end the season from the Season tab when you're done. |

If nobody votes, everyone is tied on zero and you choose. An evicted housemate's own window offers **Watch the house**. Viewers must **sign in before** they press Start watching, or the vote isn't tied to an account.

**Testing a mini-season on one machine:** create a live season, select at least 3 applicants (a separate browser profile or private window per person), have them enter, open `/watch/<season id>` as a signed-in viewer, then run the table above. `pnpm bots` can stand in as extra housemates in development, but bots have no account so they can't vote and a bot who is evicted simply leaves.

### Testing multiplayer

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
| V / M | Push-to-talk / mute |
| Mouse wheel | Zoom |
| E | Use the object you're next to (a prompt appears) — or get up again. Next to a light item: pick it up / put it down |
| 1 / 2 | Wave / dance (2 again, or moving, stops dancing) |
| Enter | Chat (Enter sends, Esc cancels) |

**Things to use:** sofa (3 seats), Diary Room chair, beds (sleep), stove (cook), treadmills (run), pool (swim, up to 6), and the TV (on/off for everyone). Walking away gets you up automatically.

**Your character:** before entering you pick a man or woman (rigged Quaternius models, CC0) and style them: skin tone, 11 hairstyles plus each model's own hair, hair colour, top, bottoms and shoe colours, and accessories (cap, beanie, bucket hat, fedora, fila, gele, headband, glasses, sunglasses, round shades, gold chain, scarf, bow tie, earrings, headphones, backpack, watch). Your look is remembered and everyone sees it.

**Needs:** like real house life, each housemate has hunger, energy, hygiene, bladder, fun, social and clean-clothes needs (0–100) that drain over time. The panel at the top left shows your mood and bars, with a tip for what to do next; a mood face appears after your name when a need runs low, and viewers see moods in the housemate list. Refill them by eating at the dining table or cooking, sleeping, showering or bathing, using the toilet, doing laundry, playing games, swimming, dancing, chatting and hanging out with people. Hold on too long and there's an accident…

**Bathroom:** through the door in the kitchen's north-west corner — two toilet stalls, two showers, a bathtub, sinks and the washing machines.

**Games hall:** through the door on the lounge's east wall. 30 games — board and card tables (chess, checkers, Ayo, Whot!, Ludo, Snakes & Ladders, Connect Four, Reversi, tic-tac-toe, ultimate tic-tac-toe, gomoku, dots & boxes, Battleship, Nine Men's Morris, Hex, Go, Yacht, Pig, Blackjack), arcade cabinets (Pong, Light Cycles, Naija Trivia, Hangman, Memory, Rock Paper Scissors, Code Breaker), 8-ball pool, six-red snooker, air hockey and darts. Press E at a station to open its board, **Take a seat**, and any seated player can **Start**. The server runs every game's rules, so each player sees the live board (hidden cards and ships stay hidden). While a board is open the keyboard belongs to the game; Esc closes it (your seat is kept — press E to go back). Walking away from the table gives up your seat. Viewers can watch any game in progress from the "Live in the games hall" list.

**Chat:** house-wide, max 280 characters, up to 3 messages in a burst then one every 1.5 s. Messages show in the panel and as a bubble over the sender's head; people who join later see the last 50.



Other scripts:

```bash
pnpm typecheck     # strict TypeScript check of every package
pnpm layout:check  # house layout sanity checks (rooms reachable, seats/doors/props/game stations usable)
pnpm games:check   # plays random games of all 30 games to the end, checking the rules never break
```

## Layout

```
apps/client      Vite + TypeScript + Three.js browser client
apps/server      Node + TypeScript + Colyseus authoritative game server
packages/shared  Types and constants shared by client and server (@bbn/shared)
```

Inside `apps/client/src`: `scene/` (renderer, house builder, follow & spectator cameras), `entities/` (avatar, name tags, voice badges), `net/` (connection, prediction, interpolation), `voice/` (VoiceProvider interface, WebRTC mesh, spatial audio, mic), `input/`, `ui/` (lobby, HUD, voice controls), `modes/` (`housemate.ts`, `spectator.ts`, `admin.ts`, and `playersView.ts` which draws everyone from server state for all three).

Inside `apps/server/src`: `rooms/HouseRoom.ts` (the authoritative room), `schema/` (synced state), `accounts/` (sign-in, seasons, applications), `http/routes.ts` (HTTP API), `db/` (Prisma client; schema in `apps/server/prisma/`), `systems/` (chat log, rate limiting, tasks, nominations/voting, payments, event log), `voice/livekit.ts` (optional LiveKit grants), `config.ts` (admin secret).

Interactable objects (seats, exit spots, ranges) are defined in `packages/shared/src/interactions.ts`, next to the house layout. Carryable props are in `props.ts`; the games hall stations are in `gameStations.ts` and each game's rules in `packages/shared/src/games/` (the 2D boards are in `apps/client/src/games/`, the server table logic in `apps/server/src/systems/gameHall.ts`). `apps/server/scripts/bot.ts` is the bot used by `pnpm bots`.

### How multiplayer works

- **Authoritative server.** Clients only send inputs (`{ seq, dx, dz }`, one per 50 ms step while moving). The server applies them with the shared collision code at 20 Hz and broadcasts positions. A modified client can't teleport or speed up: each player gets one step per tick (with a small burst allowance).
- **Jitter buffer.** Inputs arrive unevenly; the server applies one per tick and only doubles up when a backlog builds, so nobody stutters for everyone else.
- **Client-side prediction** for your own avatar: it moves the instant you press a key; when the server's position arrives, the client re-applies any inputs the server hasn't processed yet. Same code on both sides → corrections are normally zero.
- **Interpolation** for everyone else: remote avatars are drawn 100 ms in the past, blending between the two server snapshots around that time.

### How voice works

- **Peer-to-peer mesh (WebRTC), unless LiveKit is configured.** Each housemate's browser holds a direct audio connection to every other housemate; audio never touches our server. The server only relays the one-off connection setup (an *offer* and an *answer*, via `voice:signal`). Fine up to ~8 people. Set the three `LIVEKIT_*` variables and the same voice code joins one LiveKit room per house instead (`house-<seasonId>`). Viewers can listen only. Diary Room privacy is still decided in the browser: a speaker only allows the people who should hear them to subscribe.
- **Spatial audio.** Each incoming voice runs through a Web Audio `PannerNode` placed at that housemate's head; the listener sits at your head facing the camera direction.
- **Mute / push-to-talk** just disable the outgoing mic track, so they take effect in ~0.1 s with no reconnection.
- A public STUN server (Google's) helps mesh peers on different networks find each other. Some strict networks (corporate, some mobile carriers) also need a TURN relay. LiveKit replaces that path when it is configured: the SFU relays audio, so those viewers don't depend on peer-to-peer.

The house layout (`packages/shared/src/house.ts`) and the collision/movement code (`packages/shared/src/movement.ts`) live in the shared package so the server can run the exact same rules once it becomes authoritative in M2.

`@bbn/shared` is consumed as TypeScript source directly — Vite (client) and tsx (server) compile it on the fly, so there is no build step during development.

## Live voice, payments, and a public server (M9)

`pnpm dev` stays on the free mesh and SQLite. LiveKit, Paystack, and Postgres turn on only when their variables are set.

**LiveKit (optional).** One room per house. Viewers subscribe and never publish.

```bash
docker run --rm -p 7880:7880 livekit/livekit-server --dev
```

Copy the key and secret that command prints into `apps/server/.env` as `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, and set `LIVEKIT_URL=ws://localhost:7880` (the address the browser can open). Restart the game server. If those three are missing, the house answers voice with the mesh instead.

**Vote packs (optional, sandbox).** One free vote per signed-in viewer per window. A pack adds weight to that same vote (at most 10 extra). Checkout only works while voting is open. Set `PAYSTACK_SECRET_KEY` to a test key (`sk_test_…`). The watch screen then shows **5 extra votes · ₦500** — a placeholder price; change `packages/shared/src/payments.ts` and check Nigerian paid-voting rules before charging anyone. Paystack sends the viewer back to `/watch/<season>?reference=…`, and that page confirms the payment. The webhook is `POST /api/payments/webhook`.

**Analytics.** The console shows a line: people watching now, total minutes watched, and vote counts for that season. "Watching now" is sessions that haven't closed; a crashed server can leave one open until the next restart.

**PostgreSQL.** Keep SQLite for local play. For production:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/bbn pnpm --filter @bbn/server start:postgres
```

That regenerates the Prisma client for Postgres and creates missing tables. It will stop if creating them would delete data.

**Putting it on the internet for free.** The production `Dockerfile` builds the Vite page and serves it from the same Node/Colyseus process, including SPA fallbacks for `/watch`, `/house`, `/apply`, and `/bigbrother`. The included `render.yaml` deploys that image as one Render Free Web Service.

1. Push this repository to GitHub.
2. Create a free Postgres project at [Neon](https://neon.com/) and copy its connection string.
3. In Render, choose **New → Blueprint**, connect the repository, and let Render read `render.yaml`.
4. Paste the Neon connection string when Render asks for `DATABASE_URL`. Render generates `ADMIN_SECRET` and supplies `PORT` and `RENDER_EXTERNAL_URL` automatically.
5. When deployment finishes, copy the generated `ADMIN_SECRET` from the service's **Environment** page and keep it somewhere safe; it opens the platform-admin console.
6. Wait for `/health` to report `{"ok":true,...}`, then open the service's `onrender.com` URL.

Render's free service sleeps after 15 idle minutes, so the first request after a quiet period can take about a minute. Its filesystem is temporary: database-backed accounts, seasons, votes, tasks, and event history persist in Neon, but uploaded TV videos do not survive a restart. Do not use Render's free Postgres for a season you want to keep; those databases expire after 30 days.

For an early small test, voice can use the built-in peer-to-peer mesh. Add a LiveKit Cloud project later for more reliable public voice by setting `LIVEKIT_URL` (`wss://...`), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in Render. Set `PAYSTACK_SECRET_KEY` only when you are ready to test paid vote packs.

The older `fly.toml` remains available if you later move to paid, always-on Fly.io hosting.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `GAME_SERVER_PORT` | server, Vite proxy | Render's `PORT`, then `2567` | Explicit override for the game-server port |
| `ADMIN_SECRET` | server (`apps/server/.env`) | `bigbrother` in development only | Secret for the Big Brother console |
| `DATABASE_URL` | server | `file:./data/house.db` | SQLite locally; `postgres://` or `postgresql://` selects Postgres |
| `PUBLIC_URL` | server | `RENDER_EXTERNAL_URL` on Render; otherwise required in production | Site address used in sign-in links and payment returns |
| `VITE_SERVER_URL` | client | Production page origin; `<page origin>/colyseus` in development | Override the game server URL |
| `LIVEKIT_URL` | server | unset (mesh) | Browser-reachable LiveKit address (`ws://` or `wss://`) |
| `LIVEKIT_API_KEY` | server | unset | LiveKit API key |
| `LIVEKIT_API_SECRET` | server | unset | LiveKit API secret |
| `PAYSTACK_SECRET_KEY` | server | unset (packs hidden) | Paystack secret; test keys start with `sk_test_` |
