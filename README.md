# P4Pair

P4Pair is a two-person browser chat built for MuLearn CET Tech Team Recruitment Task 01. A small
Node/WebSocket server introduces the browsers; text and files then travel directly between them
over WebRTC data channels.

## Features

- Ephemeral two-person rooms with shareable invitation links
- Typed WebSocket signaling for SDP offers, answers, and ICE candidates
- Real-time peer-to-peer text messages
- Explicit waiting, connecting, connected, reconnecting, disconnected, and failed states
- Delivery acknowledgements and typing state sent peer to peer
- Direct files up to 25 MB with chunking, backpressure, progress, cancellation, and downloads
- Local connection timeline that makes negotiation understandable during a demo
- STUN-backed ICE discovery for common cross-network connections
- Responsive, keyboard-accessible interface

The signaling server does not receive chat text or file bytes. Messages are held only in the two
open pages and disappear when the page closes.

## Stack

- React 19, TypeScript, and Vite
- Native browser WebRTC (`RTCPeerConnection` and `RTCDataChannel`)
- Node.js, Express, and `ws`
- Vitest for protocol, room, and signaling integration tests

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in two browser tabs. Create a room in the first tab, enter its code in
the second, and send a message after both pages show “Direct channel open.”

`npm run dev` starts:

- Vite at `http://localhost:5173`
- The signaling server at `http://localhost:3001`
- A Vite WebSocket proxy from `/signal` to the signaling server

No account, database, OAuth provider, or secret is required.

## Production

```bash
npm run build
npm start
```

The Node process serves the production frontend, `GET /health`, and the WebSocket endpoint
`/signal` on one origin. Set these variables when needed:

```env
PORT=3001
ALLOWED_ORIGIN=https://your-domain.example
VITE_SIGNAL_URL=
```

Leave `VITE_SIGNAL_URL` blank for a same-origin deployment. The deployment host must support
long-lived WebSockets; a serverless platform that terminates WebSocket connections will not work.

### Deploy on Render

The repository includes `render.yaml` for a single free Render web service:

1. Open [Render Blueprints](https://dashboard.render.com/blueprints).
2. Connect this GitHub repository.
3. Render detects `render.yaml`; approve the `p4pair` service.
4. Open the assigned `https://...onrender.com` URL after the build finishes.

Free services may take about a minute to wake after being idle.

## STUN and TURN

The client uses public Google STUN servers by default. STUN works for many home, campus, and mobile
networks, but it does not guarantee a direct route through every NAT or firewall. Managed TURN is
the fallback for restrictive networks.

To configure Metered TURN:

1. Create a free account at [Metered](https://dashboard.metered.ca/signup).
2. Create a TURN credential and copy its credential API key.
3. In Render, open the service's **Environment** page and add:

   ```env
   METERED_TURN_DOMAIN=your-app-name.metered.live
   METERED_TURN_API_KEY=your-credential-api-key
   ```

4. Save the environment variables and let Render redeploy.

The API key stays on the Node server. Browsers call `/api/ice-servers`; the server fetches and
caches the provider's ICE array without exposing the key. If TURN is unavailable, P4Pair falls back
to STUN and explains that limitation in the connection timeline.

## How signaling differs from chat

The WebSocket server is used only before and around the direct connection:

1. Create or join an in-memory room.
2. Forward an SDP offer and answer.
3. Forward ICE candidates describing possible network routes.
4. Notify the remaining peer when a socket leaves.

Once the `chat` and `files` data channels open, their payloads move between browsers. WebRTC
encrypts data channels with DTLS. P4Pair accurately describes this as encrypted in transit; it does
not claim verified peer identity because fingerprints are not authenticated out of band.

## Quality checks

```bash
npm run check
```

This runs ESLint, strict client/server type checks, unit and signaling integration tests, and both
production builds.

## Project map

- `shared/protocol.ts` — signaling message types and runtime validation
- `server/room-manager.ts` — ephemeral two-peer rooms
- `server/index.ts` — HTTP, WebSocket signaling, origin checks, and heartbeat cleanup
- `src/hooks/usePeerSession.ts` — WebRTC state machine, chat, and files
- `src/App.tsx` — room and conversation interface
- `docs/ARCHITECTURE.md` — data flow, boundaries, and trade-offs
- `docs/DESIGN_SYSTEM.md` — visual and interaction rules

## Current limitations

- Rooms live in one server process; horizontal scaling would need shared room state or sticky
  sessions.
- There is no TURN service configured by default.
- Refreshing a page clears its local messages and files.
- Group chat is intentionally deferred; a mesh would require one peer connection per participant.
