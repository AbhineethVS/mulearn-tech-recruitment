# Architecture

## Runtime shape

P4Pair is one TypeScript project with two runtimes:

1. The React client creates rooms, negotiates WebRTC, and owns messages and files.
2. The Node server serves the production build and accepts signaling WebSockets at `/signal`.

There is no account system, database, or server-side message history. Rooms exist only in the
signaling process memory and are deleted after both sockets leave.

## Connection flow

1. The first browser opens a WebSocket and asks the server to create a room.
2. The second browser joins with the eight-character code.
3. The server tells the existing browser that a peer arrived.
4. That browser creates an `RTCPeerConnection`, two data channels, and an SDP offer.
5. The server forwards the offer, answer, and trickled ICE candidates between the paired sockets.
6. After WebRTC connects, chat and file payloads travel over the data channels. The signaling server
   cannot read or store those payloads.

The server-designated existing peer always offers, avoiding offer collision. Candidates received
before `setRemoteDescription` are queued and applied afterward.

## Code boundaries

- `shared/protocol.ts` defines and validates the signaling protocol used by both runtimes.
- `server/room-manager.ts` owns two-peer room membership without knowing about SDP.
- `server/index.ts` owns HTTP, WebSocket origin checks, heartbeat cleanup, and signal forwarding.
- `src/lib/signaling.ts` wraps the browser WebSocket.
- `src/lib/peer-connection.ts` owns ICE configuration and browser WebRTC utilities.
- `src/hooks/usePeerSession.ts` coordinates signaling, connection state, messages, acknowledgements,
  typing, disconnects, and files.
- `src/App.tsx` renders the room and conversation states without implementing network protocols.

## Data channels

`chat` is a reliable ordered channel carrying JSON envelopes for text, delivery acknowledgements,
and typing state. `files` is a separate reliable ordered channel so file buffering does not share
the chat protocol. Files are capped at 25 MB, split into 16 KiB binary chunks, and paused when the
channel buffer crosses its threshold.

After ICE connects, the client reads the selected candidate pair through `RTCPeerConnection`
statistics. Host-only pairs are shown as direct host routes, server-reflexive pairs as direct STUN
routes, and relay candidates as TURN routes. This keeps the UI accurate instead of calling every
WebRTC session physically direct.

## Network traversal

The default ICE configuration uses public STUN servers. STUN lets many peers discover a usable
public route, but it cannot traverse every NAT or firewall. In production, the server can use a
credential-scoped Metered API key to fetch and cache managed TURN configuration for the browsers.
TURN relays DTLS-encrypted WebRTC traffic when no direct route works; it is not the signaling
server and it does not receive plaintext chat messages.

## Security boundaries

- WebSocket messages are validated and limited to 64 KiB.
- Rooms contain at most two peers and use cryptographically random codes.
- Production WebSocket upgrades require a matching configured or same-host origin.
- React renders peer text as text, not HTML.
- WebRTC encrypts data channels with DTLS. This protects transport, but without out-of-band
  fingerprint verification the app does not claim authenticated peer identity.

## Deployment

`npm run build` creates `dist/` and `server-dist/`. `npm start` runs one Node process that serves
the frontend, `/health`, and `/signal`. The host must support long-lived WebSocket connections;
serverless hosts that terminate WebSockets are unsuitable.
