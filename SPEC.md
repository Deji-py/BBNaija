# Big Brother Ninja — Build Specification

> **Working title:** Big Brother Ninja
> **Type:** Lightweight, low-poly, browser-based 3D multiplayer social game + live spectator platform
> **Goal:** Commercial product. Build lean, prove the core experience, then grow.
> **Audience for this doc:** The implementing agent (Claude desktop / Claude Code) and the project owner.

---

## 0. Instructions for the Implementing Agent

Read this whole file before writing code. Then follow these rules:

1. **Build milestone by milestone, in order** (Section 9). Do not start a milestone until the previous one meets every acceptance criterion.
2. **After each milestone:** run it, verify the acceptance criteria yourself where possible, tell the owner exactly how to test it (commands + what they should see), and wait for confirmation before moving on.
3. **Stay inside the tech stack** in Section 5. Ask the owner before adding any major dependency not listed.
4. **Keep it lightweight.** Low-poly primitives, no heavy assets, no premature optimisation, no features from later milestones.
5. **Everything must run locally for free** until Milestone 9 (deployment).
6. **Use TypeScript everywhere**, strict mode on. Shared types live in `packages/shared`.
7. **Commit at the end of each milestone** with a message like `M2: multiplayer position sync`.
8. **Keep `README.md` updated** with setup and run instructions as features land.
9. The owner can code but is new to game development — **explain game-dev concepts briefly** when you introduce them (game loop, interpolation, authoritative server, etc.).

---

## 1. Concept

A virtual Big Brother house that lives on the web.

- Anyone can **apply** to become a housemate for a season.
- **Selected housemates** enter a shared 3D low-poly house. Each joins from their own device, anywhere in the world.
- Inside, housemates **walk around, talk by voice, text chat, and interact with the house** (sit, cook, sleep, work out, etc.). They live their virtual lives freely — nothing is scripted.
- **"Big Brother"** (the admin/host) sets tasks, calls housemates to the **Diary Room**, and runs nominations.
- **The public watches live** as spectators: they can switch between house cameras, follow a favourite housemate, and hear the conversations.
- **Viewers vote** to save housemates. The least-saved nominees are **evicted**. Last housemate standing wins.

### The key technical insight (keeps costs tiny)

Spectators do **not** watch a video stream. They load the same 3D house in their browser and render it from the live game state (positions, animations, chat) plus the voice audio. That means:
- No video encoding or video CDN costs.
- Viewers get free camera control (switch rooms, follow anyone).
- It scales like a multiplayer game, not like Twitch.

A "real" video stream (e.g. to YouTube/TikTok Live for marketing) can be added later by running one headless spectator client and streaming its screen.

---

## 2. User Roles

| Role | Who | Can do |
|---|---|---|
| **Visitor** | Anyone on the site | Browse, watch a teaser, sign up |
| **Viewer** | Registered user | Watch live, switch cameras, follow housemates, text-react, vote |
| **Applicant** | Viewer who applied | Submit application (profile, short bio, intro video/audio link), track status |
| **Housemate** | Selected applicant during a live season | Enter the house, move, talk, chat, interact, do tasks, use Diary Room, nominate |
| **Big Brother (Admin)** | Owner/production team | Manage seasons, select housemates, set tasks, run Diary Room, open/close voting, evict, moderate (mute/kick/ban) |

---

## 3. Core Game Loop (one season)

1. **Applications open** → people apply.
2. **Selection** → Admin reviews and picks N housemates (start with 6–8; see voice notes in Section 6).
3. **Launch night** → housemates enter the house, viewers watch.
4. **Daily life** → free roam, conversations, activities, Big Brother tasks.
5. **Nominations** (weekly or on a set schedule) → housemates privately nominate in the Diary Room.
6. **Voting window** → viewers vote to save nominees.
7. **Eviction** → lowest-vote nominee leaves the house live (becomes a viewer again).
8. Repeat 4–7 until the **finale** → winner crowned.

Seasons can be short (e.g. 3–7 days) to start; real-time daily sessions (e.g. 2–3 live hours per evening) are more realistic for volunteer housemates than 24/7.

---

## 4. Feature List

### 4.1 The House (3D world)
- Low-poly house built from primitives first, CC0 assets later (Kenney.nl, Quaternius).
- Areas: **Lounge, Kitchen, Bedroom, Garden/Pool, Gym, Diary Room**.
- Day/night lighting cycle tied to real time or session time.
- Fixed **house cameras** in each area (for spectators) plus free/follow camera.

### 4.2 Housemates
- Simple low-poly avatar (capsule body + head), customisable colour and name tag.
- Third-person camera, WASD/arrow movement, mobile touch joystick later.
- Animations (procedural to start): idle, walk, sit, sleep, wave, dance.
- **Interactable objects**: sofa (sit), bed (sleep), stove (cook), treadmill (work out), pool (swim), TV, fridge. Walk up + press `E` → action plays, everyone sees it.
- Emotes on number keys.

### 4.3 Communication
- **Proximity voice**: you hear housemates louder the closer they are (spatial audio). This creates natural group conversations and "whispering in the garden" drama.
- Push-to-talk and open-mic modes; mute toggle; speaking indicator above head.
- **Text chat** for housemates (house-wide) — visible to viewers.
- **Diary Room**: private voice/text between one housemate and Big Brother. Optionally broadcast to viewers (classic format) or kept private.

### 4.4 Spectator Experience
- Watch the live house in 3D in the browser.
- Camera modes: house cameras (per room), follow-a-housemate, free fly.
- Audio follows the camera position (you hear what that camera "hears").
- Live viewer count, housemate list with status (awake, sleeping, in Diary Room).
- Viewer reactions (emoji floating over the scene) and a separate viewer chat (housemates **cannot** see viewer chat — keeps the bubble intact).
- Voting panel during voting windows.

### 4.5 Big Brother Admin Console
- Season management (create, open applications, start, end).
- Applicant review + select/reject.
- Live controls: announcements (house-wide voice/text "Big Brother speaking"), call housemate to Diary Room, assign tasks, start/stop nominations and voting, trigger eviction.
- Moderation: mute, kick, ban, remove from season.
- Event log of everything that happened.

### 4.6 Tasks & Activities
- Admin-defined tasks with title, description, duration, reward.
- Built-in mini-activities to start with: **cooking challenge** (interact with stove sequence), **treasure hunt** (find hidden objects in the house), **quiz** (on-screen multiple choice).
- Rewards: perks (immunity, extra nomination power, cosmetic items).

### 4.7 Applications & Accounts
- Sign up / login (email magic link or OAuth; MVP can be name-only for local testing).
- Application form: display name, age confirmation (18+), country, bio, why you should be selected, link to intro clip, availability for the season schedule.
- Consent checkboxes: being broadcast publicly, voice recording, house rules.

### 4.8 Voting
- One free vote per viewer per voting window.
- Optional paid vote packs (see Section 8) — strictly rate-limited and auditable.
- Results hidden until eviction moment.

---

## 5. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) | One language client + server, shared types |
| Monorepo | **pnpm workspaces** | Simple, fast |
| Client build | **Vite** | Instant dev server |
| 3D | **Three.js** | Lightweight, huge ecosystem |
| UI overlay | **Plain HTML/CSS** over the canvas (React only if UI grows large — ask first) | Keep it light |
| Multiplayer server | **Node.js + Colyseus** | Authoritative rooms, state sync, schema-based deltas |
| Voice (MVP) | **WebRTC peer-to-peer mesh**, signalling over Colyseus | Free, no extra server |
| Voice (scale) | **LiveKit** (open source SFU, self-host or cloud) | Needed beyond ~8 voices and for audience audio |
| Spatial audio | **Web Audio API** `PannerNode` | Proximity voice |
| Database | **SQLite via Prisma** locally → **PostgreSQL** in production | Same Prisma code both ways |
| Auth (later) | Lucia / Auth.js or simple magic-link | Decide at M7 |
| Deploy (later) | Client: Vercel/Netlify/Cloudflare Pages. Server: Fly.io / Railway / a VPS | Cheap |

**Ports (local):** client `http://localhost:5173`, game server `ws://localhost:2567`.

---

## 6. Architecture

```
┌─────────────────────────┐        WebSocket (Colyseus)        ┌──────────────────────────┐
│  Browser: Housemate     │ ◄────────────────────────────────► │                          │
│  Three.js scene         │   inputs up / state deltas down     │   Game Server (Node)     │
│  Mic → WebRTC           │                                     │   Colyseus "HouseRoom"   │
└──────────┬──────────────┘                                     │   - authoritative state  │
           │  WebRTC audio (P2P mesh in MVP, LiveKit later)     │   - 20 Hz tick           │
           ▼                                                    │   - WebRTC signalling    │
┌─────────────────────────┐                                     │   - tasks / votes / log  │
│  Browser: Housemate 2…N │ ◄────────────────────────────────► │                          │
└─────────────────────────┘                                     └────────────┬─────────────┘
                                                                             │ Prisma
┌─────────────────────────┐   WebSocket (read-only "spectator")   ┌──────────▼─────────────┐
│  Browser: Viewer        │ ◄──────────────────────────────────── │  DB (SQLite → Postgres)│
│  Same Three.js scene,   │                                       └────────────────────────┘
│  renders from state     │
└─────────────────────────┘
```

### Networking model
- **Authoritative server.** Clients send *inputs* (move direction, action requests), server validates and updates state, broadcasts state.
- Server tick: **20 Hz**. Client sends input at up to 20 Hz.
- Client renders **remote players with interpolation** (~100 ms buffer) so movement looks smooth.
- Local player uses **client-side prediction** (move immediately, reconcile with server) — add in M2 only if movement feels laggy.

### Voice notes
- P2P mesh: each housemate connects to every other. Fine for **up to ~6–8** people. Beyond that bandwidth/CPU explode.
- Build voice behind a `VoiceProvider` interface (`join`, `leave`, `setMuted`, `onRemoteStream`, `setListenerPosition`, `setSourcePosition`) so swapping mesh → LiveKit is a contained change.
- Spectators never send audio. In MVP they can join the mesh as receive-only peers for small tests; real audience audio requires LiveKit (M9).

### Room types (Colyseus)
- `HouseRoom` — one per live season. Housemates join with role `housemate`; spectators join with role `viewer` (receive state, can't move).
- Later: separate spectator relay rooms if one room can't hold all viewers.

---

## 7. Data Model (initial)

### Live room state (Colyseus Schema, in memory)
```ts
Player {
  id: string            // session id
  userId: string
  name: string
  color: string
  role: "housemate" | "viewer" | "admin"
  x: number; y: number; z: number
  rotY: number
  anim: "idle" | "walk" | "sit" | "sleep" | "wave" | "dance" | "cook" | "swim" | "workout"
  area: string          // "lounge", "kitchen", ...
  speaking: boolean
  muted: boolean
  status: "active" | "diary" | "evicted"
}

HouseState {
  players: MapSchema<Player>      // housemates only
  viewerCount: number
  phase: "free" | "task" | "nominations" | "voting" | "eviction"
  currentTask?: TaskState
  announcements: ArraySchema<string>
  timeOfDay: number               // 0–24
}
```

### Persistent (Prisma)
```
User         id, email, displayName, createdAt, isAdmin, bannedAt?
Season       id, name, status(draft|applications|live|ended), startsAt, endsAt, maxHousemates
Application  id, userId, seasonId, bio, motivation, clipUrl, country, ageConfirmed, status(pending|selected|rejected), createdAt
Housemate    id, userId, seasonId, status(active|evicted|winner), evictedAt?
Task         id, seasonId, title, description, type, startsAt, durationSec, reward
Nomination   id, seasonId, round, nominatorId, nomineeId, createdAt
VoteWindow   id, seasonId, round, opensAt, closesAt, nomineeIds[]
Vote         id, voteWindowId, userId, nomineeId, weight, paid(boolean), createdAt
EventLog     id, seasonId, type, payload(json), createdAt
Report       id, reporterId, targetUserId, reason, createdAt, resolved
```

### Message protocol (client → server)
```
"input"        { dx, dz, rotY }            // movement intent
"action"       { objectId, action }        // interact with object
"emote"        { name }
"chat"         { text }                     // max 280 chars, rate-limited
"voice:signal" { to, data }                 // WebRTC offer/answer/ice relay
"voice:state"  { speaking, muted }
"nominate"     { nomineeId }                // only in diary + nominations phase
"vote"         { nomineeId }                // viewers, voting phase
"admin:*"      { ... }                      // admin-only, server-verified
```

---

## 8. Monetisation (design now, build at M9)

Ideas, roughly in order of ease:
1. **Paid votes / vote packs** — the proven reality-TV model. Requires a payment provider (e.g. Paystack/Flutterwave for Nigeria, Stripe internationally), anti-fraud limits, and a clear terms page. Check local rules on paid voting and consumer protection before launch.
2. **Viewer subscription** ("Super Fan"): ad-free, exclusive camera angles, Diary Room replays, badge in viewer chat.
3. **Sponsored tasks / branded house items** — brands pay to place a product or task in the house.
4. **Application fee** for premium/featured applications (careful: can look exploitative; consider making it optional "fast-track review").
5. **Cosmetics** for housemates (outfits, house items) bought by fans as gifts.
6. **Highlight clips** pushed to TikTok/YouTube/Instagram for audience growth.

---

## 9. Milestones

Each milestone ends with a runnable build and a commit.

### M0 — Project Setup
- pnpm monorepo: `apps/client`, `apps/server`, `packages/shared`.
- Vite + TS client, Node + TS + Colyseus server, shared types package.
- Scripts: `pnpm dev` runs client and server together.
- **Accept when:** `pnpm install && pnpm dev` starts both; client page loads; server logs "listening on 2567".

### M1 — Solo House & Character
- Three.js scene: low-poly house with all six areas built from boxes/planes, lights, floor, walls with door gaps.
- Player avatar (capsule + head + name tag), WASD movement, third-person follow camera, simple wall collision (AABB is fine).
- Procedural idle/walk animation (bob + limb swing).
- **Accept when:** one player can walk through every room smoothly at 60 fps on a normal laptop and can't walk through walls.

### M2 — Multiplayer Sync
- `HouseRoom` in Colyseus; join with a name and colour from a simple lobby screen.
- Server-authoritative movement at 20 Hz; client interpolation for remote players.
- Join/leave handled cleanly (avatars appear/disappear).
- **Accept when:** two browser windows (and two machines on the same network) see each other move smoothly with no jitter; closing a tab removes that avatar for others.

### M3 — Proximity Voice
- `VoiceProvider` interface + WebRTC mesh implementation; signalling through Colyseus messages.
- Mic permission flow, mute button, push-to-talk (`V`) and open-mic toggle.
- Spatial audio with `PannerNode`: volume falls off with distance (inaudible beyond ~15 m), walls ignored for MVP.
- Speaking indicator above heads.
- **Accept when:** two people on different machines hear each other clearly; moving apart fades the voice; mute works instantly.
- Note: testing across machines requires HTTPS or `localhost`; document how (e.g. a tunnel like `cloudflared` or `ngrok`).

### M4 — Chat, Emotes & Interactions
- House text chat (rate-limited, length-capped).
- Emotes (wave, dance) via number keys.
- Interactable objects (sofa, bed, stove, treadmill, pool, TV) with `E` prompt; server validates proximity; animation visible to all.
- **Accept when:** a player can sit on the sofa, cook at the stove, sleep in bed, and everyone else sees it; chat appears for all.

### M5 — Spectator Mode
- Viewer entry point (`/watch`): joins as `viewer`, no avatar, receive-only.
- Camera modes: per-room house cameras, follow-housemate, free fly.
- Viewer count display; housemate list with status.
- Viewer emoji reactions + separate viewer chat (never shown to housemates).
- Audio: viewer hears from camera position (receive-only peer in MVP).
- **Accept when:** a third browser can watch two housemates live, switch cameras, follow one, and hear them.

### M6 — Big Brother Console, Tasks & Diary Room
- Admin route (`/bigbrother`) protected by an admin secret for now.
- Announcements (text banner + optional voice from admin mic).
- Diary Room: admin "calls" a housemate → they're teleported/walk to the Diary Room → private voice channel with admin only.
- Task system with the three starter activities (cooking challenge, treasure hunt, quiz) and rewards.
- Moderation: mute, kick.
- Event log.
- **Accept when:** admin can run a full task from start to reward, hold a private Diary Room conversation, and mute/kick a housemate.

### M7 — Accounts, Seasons & Applications
- Prisma + SQLite; auth (magic link or OAuth — pick the simplest that works locally).
- Public landing page, application form with consents and 18+ confirmation.
- Admin applicant review → select → selected users get access to enter the house during the live season.
- **Accept when:** a new user can apply, admin selects them, and only selected users can enter as housemates.

### M8 — Nominations, Voting & Evictions
- Nomination phase: housemates nominate privately in the Diary Room.
- Voting window with live countdown for viewers; one free vote per viewer per window.
- Eviction ceremony: admin reveals result, evicted housemate's avatar exits the house and they become a viewer.
- Finale and winner screen.
- **Accept when:** a full mini-season (≥3 housemates) can be run end to end on a local machine with viewers voting.

### M9 — Scale, Payments & Deploy
- Swap voice to **LiveKit** (rooms per house; viewers subscribe-only).
- Deploy client + server + Postgres; HTTPS; environment configs.
- Payment integration for vote packs / subscription (sandbox first).
- Basic analytics (viewers, watch time, votes).
- **Accept when:** a public URL hosts a live test season with external friends as housemates and viewers.

### M10 — Safety & Launch Readiness
- Reporting system for viewers and housemates; admin review queue.
- Ban list; profanity filter on chat; rate limits everywhere.
- Terms of Service, Privacy Policy, House Rules, broadcast/recording consent.
- Data protection compliance for where you operate (e.g. Nigeria Data Protection Act; GDPR if you accept EU users).
- **Accept when:** owner signs off on a pre-launch checklist.

---

## 10. Project Structure

```
big-brother-ninja/
├─ package.json
├─ pnpm-workspace.yaml
├─ README.md
├─ apps/
│  ├─ client/
│  │  ├─ index.html
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ scene/        # house builder, lighting, cameras
│  │  │  ├─ entities/     # avatar, interactable objects
│  │  │  ├─ net/          # Colyseus client, interpolation
│  │  │  ├─ voice/        # VoiceProvider, mesh impl, spatial audio
│  │  │  ├─ ui/           # lobby, HUD, chat, voting, admin
│  │  │  └─ modes/        # housemate.ts, spectator.ts, admin.ts
│  │  └─ vite.config.ts
│  └─ server/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ rooms/HouseRoom.ts
│     │  ├─ schema/        # Colyseus state classes
│     │  ├─ systems/       # movement, interactions, tasks, voting
│     │  └─ db/            # Prisma client
│     └─ prisma/schema.prisma
└─ packages/
   └─ shared/
      └─ src/              # message types, constants, house layout data
```

---

## 11. Non-Goals (for now)

- Native mobile apps (web works on mobile; touch controls come after M8).
- Realistic graphics, motion capture, or face tracking.
- Video webcams of housemates.
- 24/7 always-on houses (start with scheduled live sessions).
- Blockchain/NFT anything.

---

## 12. Risks & Open Questions

- **Name/trademark:** "Big Brother" and "Big Brother Naija" are registered trademarks (owned by Banijay/Endemol Shine). Using them commercially risks a takedown or legal action. Pick an original brand before public launch; keep "Big Brother Ninja" as an internal codename only.
- **Housemate commitment:** real people must show up on schedule. Mitigate with short seasons, fixed session times, and backup housemates.
- **Moderation:** live voice in front of an audience can go wrong fast. Admin tools (M6) and safety (M10) are not optional.
- **Voice scale:** mesh caps at ~8. LiveKit migration is planned at M9.
- **Paid voting rules:** confirm the legal and payment-provider requirements in each launch country.
- **Open:** season length and session schedule? Max housemates per season? Diary Room broadcast or private by default?
