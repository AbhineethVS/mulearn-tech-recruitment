# Architecture

## Runtime shape

P4Pair is one TypeScript project with two runtimes:

1. The React client creates rooms, negotiates WebRTC, and owns messages and files.
2. The Node server serves the production build and accepts signaling WebSockets at `/signal`.

There is no account system, database, or server-side message history. Rooms exist only in the
signaling process memory and are deleted after their last socket leaves.

## Connection flow

1. The first browser opens a WebSocket and asks the server to create a room.
2. Other browsers join with the eight-character code.
3. The server sends the existing members the new peer ID.
4. Each existing member creates one `RTCPeerConnection` and addressed SDP offer for the newcomer.
5. The server validates and routes offers, answers, and trickled ICE candidates only to the named
   member of the same room.
6. After WebRTC connects, content travels over pairwise data channels. The signaling server cannot
   read or store those payloads.

Existing peers always offer to the newcomer, avoiding offer collision. A private room has one link;
a four-person group forms a full mesh of six links. Candidates received before
`setRemoteDescription` are queued independently for each remote peer and applied afterward.

Each room membership receives a random resume token stored in that tab's session storage. The
token survives a reload without leaking into a second same-browser tab. If a mobile browser
reloads or resumes before its old WebSocket has timed out, presenting the token atomically replaces
the stale socket instead of producing a false `room_full` error. A browser without the token still
cannot claim that membership. Heartbeats remove abandoned sockets within about 30 seconds.
The latest token is also retained as a device-local fallback: a newly opened tab attempts a normal
join first and presents that fallback only after the full room rejects it. This preserves ordinary
two-tab testing while allowing a restarted mobile browser to reclaim its own stale membership.

## Code boundaries

- `shared/protocol.ts` defines and validates the signaling protocol used by both runtimes.
- `server/room-manager.ts` owns two-peer private and four-peer group membership without knowing
  about SDP.
- `server/index.ts` owns HTTP, WebSocket origin checks, heartbeat cleanup, and signal forwarding.
- `src/lib/signaling.ts` wraps the browser WebSocket.
- `src/lib/peer-connection.ts` owns ICE configuration and browser WebRTC utilities.
- `src/hooks/usePeerSession.ts` coordinates signaling, connection state, messages, acknowledgements,
  typing, disconnects, and files.
- `src/App.tsx` renders the room and conversation states without implementing network protocols.

## Data channels

`chat` is a reliable ordered channel carrying JSON envelopes for text, quoted replies, emoji
reactions, edits, deletion tombstones, peer display names, delivery acknowledgements, seen
receipts, typing state, and private call controls. Group messages fan out over every open pairwise
channel. Display names, message interactions, and call invitations therefore remain peer content
and are not stored by signaling. One tick means the local browser wrote the message to all
intended channels, two ticks mean every intended peer acknowledged it, and blue ticks mean every
intended peer displayed the conversation in a visible, focused page. The receipt tooltip exposes
partial group progress.

Private rooms also create `files`, a separate reliable ordered channel so binary buffering does not
share the chat protocol. Files are capped at 25 MB, split into 16 KiB binary chunks, and paused when the channel
buffer crosses its threshold. Voice messages use this same bounded transfer path with typed voice
metadata, a browser-selected audio codec, a two-minute recording limit, and waveform samples for
the interface. Audio bytes never enter signaling or the service-worker cache.

## Private voice calls

Private links add one `sendrecv` audio transceiver before their initial offer. It has no local
track, so establishing a room does not activate hardware or request permission. On call acceptance,
each browser requests echo-cancelled, noise-suppressed audio and attaches it with
`RTCRtpSender.replaceTrack()`. This avoids a second SDP exchange, offer glare, and disturbance to
the existing data channels. Live audio follows the selected WebRTC media route; it is not encoded
inside a WebSocket or data-channel message.

Typed `call_invite`, `call_accept`, `call_ready`, decline, cancel, end, and mute envelopes use the
ordered `chat` data channel. A call ID rejects stale controls. If invitations cross, the lower peer
ID keeps its outgoing invitation and the other browser adopts it as incoming. A media-generation
counter invalidates late permission results after cancellation. Hang-up, peer departure, retry,
hard connection failure, room leave, and component cleanup all detach the sender and stop local
tracks. Group rooms neither create audio transceivers nor accept call controls.

After ICE connects, the client reads the selected candidate pair through `RTCPeerConnection`
statistics. Host-only pairs are shown as direct host routes, server-reflexive pairs as direct STUN
routes, and relay candidates as TURN routes. This keeps the UI accurate instead of calling every
WebRTC session physically direct. The same statistics provide the selected pair's current
round-trip time, which is classified as excellent, good, fair, or unstable and displayed in the
route-details dialog.

## PWA boundary

The production service worker precaches the generated application shell and serves it when
navigation is offline. Hashed scripts, styles, fonts, and images are cached as static assets.
`/signal`, `/health`, and `/api/*` are always network-only, so stale room state or TURN credentials
cannot be replayed from a cache. The offline shell is informational: a new room still requires
network access to signaling, and peer content remains outside the service worker cache.

Invitation QR codes are rendered locally from the same room URL used by copy and native sharing.
No external QR service receives the invitation.

## Network traversal

The default ICE configuration uses public STUN servers. STUN lets many peers discover a usable
public route, but it cannot traverse every NAT or firewall. In production, the server can use a
credential-scoped Metered API key to fetch and cache managed TURN configuration for the browsers.
TURN relays DTLS-encrypted WebRTC traffic when no direct route works; it is not the signaling
server and it does not receive plaintext chat messages.

## Security boundaries

- WebSocket messages are validated and limited to 64 KiB.
- Private rooms contain at most two peers; text group rooms contain at most four. Both use
  cryptographically random codes.
- SDP and ICE messages are addressed to a peer ID; the server validates room membership and stamps
  the trusted sender ID before relaying.
- Resume tokens are random, room-scoped capabilities and are never sent to the other peer.
- Production WebSocket upgrades require a matching configured or same-host origin.
- React renders peer text as text, not HTML.
- WebRTC encrypts data channels with DTLS. This protects transport, but without out-of-band
  fingerprint verification the app does not claim authenticated peer identity.

## Deployment

`npm run build` creates `dist/` and `server-dist/`. `npm start` runs one Node process that serves
the frontend, `/health`, and `/signal`. The host must support long-lived WebSocket connections;
serverless hosts that terminate WebSockets are unsuitable.
