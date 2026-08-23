# ♠ Bhabhi — Online Real-Time Multiplayer Card Game

A server-authoritative online multiplayer implementation of **Bhabhi** (also known as
*Thulla* or *Getaway*), designed to run entirely on free hosting tiers:
Vercel (frontend) + Render (backend) + Neon PostgreSQL (database).

---

## Features

### Server-authoritative game engine
- Single 52-card deck, cryptographic Fisher–Yates shuffle (`crypto.randomInt`).
- Supports **3 to 8 players**.
- Enforces the Ace of Spades (♠A) opening, mandatory suit-following, and the
  **Tochoo / Thulla** penalty pickup.
- The client never decides anything: turn order, legal moves, card ownership,
  trick winners, eliminations and the final Bhabhi are all computed on the server.
- Per-player state sanitization — a player only ever receives their own hand.

### Real-time multiplayer
- Socket.IO with **mandatory JWT authentication on every connection**; every event
  is authorized against the sender's verified identity and game membership.
- Private rooms with cryptographically random 6-character codes.
- Public quick-match queue for 3–8 players.
- Reconnection recovery: a dropped player re-authenticates and is restored to
  their seat with a fresh sanitized state.
- 60-second disconnect grace period before auto-play takes over.

### AI bots
Three difficulty levels (easy / normal / hard) with heuristic play: void-suit
management, safe discarding, and Tochoo avoidance.

### Voice chat (WebRTC)
- Peer-to-peer audio mesh using free Google STUN servers.
- **Opt-in only** — the microphone is never enabled automatically; `getUserMedia`
  runs solely in response to the user pressing *Join Voice*.
- Signaling is authenticated and restricted to peers in the same game room.
- Voice-activity detection drives the speaking indicators.
- No TURN server is configured (none is free), so a small number of users behind
  restrictive NATs will see *"Voice connection could not be established."*
  The game itself is unaffected when voice fails.

### Social & stats
- Unique public Player IDs (e.g. `BHABHI-7K29X`) for friend requests.
- Friends list with presence, and **friends-only** game invitations.
- Per-player statistics and a global leaderboard.

---

## Architecture

```
Browser (Vercel)                Render Web Service            Neon
┌────────────────┐   REST/WS   ┌────────────────────┐  SQL  ┌──────────┐
│ React + Vite   │────────────▶│ Express + Socket.IO│──────▶│ Postgres │
│                │             │ GameEngine (memory)│       └──────────┘
└────────┬───────┘             └────────────────────┘
         │  WebRTC audio (peer-to-peer, STUN-assisted)
         └──────────────▶ other browsers
```

**Live game state lives in server memory**, not the database. PostgreSQL stores
only durable records: users, friendships, invitations, completed game history and
statistics. Per-trick state is deliberately never written to the database — that
would burn Neon Free compute on data discarded minutes later.

---

## Local development

```bash
npm install
cp .env.example .env
```

Then set at minimum a `JWT_SECRET` in `.env` (the server refuses to start without one):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```bash
npm run dev        # frontend + backend together on http://localhost:3000
npm test           # full test suite
npm run typecheck  # TypeScript strict-mode check
npm run build      # production build
```

`DATABASE_URL` is optional in development — without it the server uses a
temporary in-memory store and says so loudly. **This fallback does not exist in
production**: a missing or unreachable database causes the server to exit.

---

## Deployment

### 1. Database — Neon PostgreSQL (free)

Create a project at [neon.tech](https://neon.tech) and copy the connection string.
There is no separate migration step: the server applies its schema idempotently on
every boot (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`).

The project uses the **`pg` driver with plain SQL**. There is no Prisma setup.

### 2. Backend — Render Web Service (free)

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

`--include=dev` is required because Render sets `NODE_ENV=production`, which would
otherwise skip the build tools (vite, esbuild, typescript).

Environment variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `JWT_SECRET` | yes | ≥32 random characters |
| `CLIENT_URL` | yes | Your Vercel origin, e.g. `https://your-app.vercel.app` |
| `NODE_ENV` | yes | `production` |

A `render.yaml` blueprint is included.

> **Free-tier caveat:** Render Free spins down after ~15 minutes of inactivity and
> cold-starts in ~50 seconds. Because live game state is in memory, any in-progress
> game is lost on spin-down. Accounts, friendships and stats are safe in Neon.

### 3. Frontend — Vercel (free)

| Setting | Value |
|---|---|
| Framework | Vite |
| Build Command | `npm run build:client` |
| Output Directory | `dist` |

Environment variables (public — never put secrets in a `VITE_*` variable):

| Variable | Value |
|---|---|
| `VITE_API_URL` | Your Render URL, e.g. `https://bhabhi-api.onrender.com` |
| `VITE_WS_URL` | Same as above |

A `vercel.json` is included with SPA rewrites and security headers.

### Alternative: unified single-server deployment

The Express server also serves the built frontend from `dist/`. Deploy only to
Render, leave `VITE_API_URL`/`VITE_WS_URL` blank, and set `CLIENT_URL` to the
Render URL. Note that `npm run build` emits the server bundle to `build/`, which
is **outside** the publicly served `dist/` directory.

---

## Security

- Socket.IO connections without a valid JWT are rejected; identity is derived
  from the verified token only — never from client-supplied fields.
- Every socket event verifies authentication, game membership and, where relevant,
  host privileges.
- Hidden hands are never transmitted to players not entitled to see them.
- Passwords are hashed with bcrypt (cost 12).
- Rate limiting on authentication, profile updates, friend requests, invitations,
  matchmaking, chat, card transfers and all other socket events.
- CORS is restricted to the configured `CLIENT_URL`; arbitrary origins are never
  reflected. Helmet supplies security headers; request bodies are capped at 64 KB.
- The server fails fast on a missing/weak `JWT_SECRET`, a missing `CLIENT_URL`, or
  an unreachable database in production.

---

## Game rules

1. **Objective** — shed all your cards. The last player still holding cards is the
   **Bhabhi**.
2. **Opening** — whoever holds the Ace of Spades (♠A) must lead the first trick.
3. **Follow suit** — you must play the led suit if you hold it.
4. **Tochoo (Thulla)** — if you cannot follow suit you may play any card, which
   immediately ends the trick; whoever played the highest card of the *led* suit
   picks up everything on the table. No Tochoo penalty applies during the first
   trick of a game.
5. **Escape** — the moment your hand is empty you are **safe**, and your finishing
   position is recorded.
6. **Endgame** — with two players left and one holding no cards, a blind draw from
   the opponent's hand decides the final trick.
