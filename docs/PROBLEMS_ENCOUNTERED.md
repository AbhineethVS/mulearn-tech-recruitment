# Problems encountered

This document records significant implementation and testing problems found while building P4Pair,
how they were diagnosed, and what the result taught us. It is intentionally evidence-based: an
error message alone is not treated as a root cause.

## WebRTC signaling succeeded, but the direct connection failed

### Symptom

Two devices joined the same room and completed the visible signaling sequence:

1. Peer found
2. Offer sent
3. ICE gathering completed
4. Answer received
5. Connection failed

The failure initially looked like either a WebRTC implementation bug or insufficient STUN
configuration. It also occurred when a phone-created hotspot was tried.

### Investigation

The browser was instrumented to record WebSocket signaling frames, calls to `addIceCandidate`,
ICE state changes, and WebRTC statistics.

The trace confirmed that:

- The SDP offer and answer were exchanged successfully.
- Both devices gathered host and server-reflexive (STUN) candidates.
- The phone's ICE candidates reached the laptop through the signaling server.
- Every remote candidate was accepted by `addIceCandidate` without an exception.
- ICE entered `checking`, but no candidate pair became selected.
- No DTLS packets were exchanged before the connection failed.

This ruled out room membership, SDP exchange, signaling delivery, candidate ordering, candidate
validation, and the data-channel setup as the immediate cause.

The next check tested local network reachability. Although both devices had addresses in the same
private subnet, the laptop could not reach the phone's address and did not learn an ARP neighbor
entry for it. This is strong evidence that the wireless network was preventing clients from
communicating directly.

Exact public and private addresses are deliberately omitted from this repository.

### Root cause

The original Wi-Fi network had wireless client isolation behavior. Depending on the router, this
may be called:

- AP isolation
- Client isolation
- Wireless isolation
- Station isolation
- Guest-network isolation

With this behavior enabled, two devices can access the internet through the same router but cannot
send local packets to each other. STUN can still discover a public address, so candidate gathering
appears successful, but ICE cannot form a working direct pair.

A phone-created hotspot was not a reliable counter-test. The phone itself may remain on the
cellular side while tethered clients are placed behind another NAT boundary.

### Resolution

The laptop's mobile hotspot was enabled and the phone was connected to that network. After both
pages were refreshed and a new room was created, the WebRTC data channel connected successfully.
This confirmed that P4Pair's direct peer connection worked when the network allowed peer traffic.

Other valid resolutions include:

- Disable client isolation in the router settings.
- Avoid guest Wi-Fi.
- Test on a network that permits communication between local clients.

### Product improvement

The original generic “connection failed” message did not help a reviewer recover. P4Pair now keeps
track of local and remote ICE candidate evidence. If both peers advertise host candidates in the
same private subnet but ICE still fails, the interface reports **“Likely local-network isolation”**
and suggests non-guest Wi-Fi, disabling AP/client isolation, checking endpoint firewalls, or using
the laptop's mobile hotspot.

This is deliberately described as “likely,” not certain. Browser JavaScript cannot run ARP or ping
tests, so it cannot distinguish router isolation from every possible endpoint firewall. Other
candidate patterns receive different guidance, including missing peer candidates, a blocked direct
route, or endpoint firewall restrictions.

### Lessons

- Successful signaling does not prove that peers can exchange network packets.
- `ICE gathering complete` means candidate discovery finished; it does not mean ICE connected.
- Candidate-level traces and `RTCPeerConnection.getStats()` are more useful than a generic
  “connection failed” message.
- A same-subnet address does not guarantee local reachability.
- STUN discovers routes; it does not bypass firewalls or client isolation.
- Network assumptions should be tested before changing otherwise-correct WebRTC code.

## Render server build omitted a shared module

### Symptom

Render built the project, but Node failed during startup:

```text
ERR_MODULE_NOT_FOUND: server-dist/shared/protocol.js
```

### Root cause and resolution

The standalone server TypeScript configuration used incremental build metadata. Render restored
stale build state and emitted `server/index.js` without the shared protocol output it imported.

Incremental compilation was removed from `tsconfig.server.json`. The production build now emits the
complete `server-dist/server/` and `server-dist/shared/` trees every time. The compiled server was
then started locally as a production smoke test before redeployment.

## A reloading mobile browser temporarily made the room look full

### Symptom

After a phone browser was suspended or reloaded, immediately joining the same invitation could
return `That room already has two people`, even though the user was replacing their own session.
If the replacement was admitted later, WebRTC still had to negotiate a fresh route and could
separately report an ICE failure.

### Root cause

Mobile browsers do not always close WebSockets before suspending a page. Until the server heartbeat
expired that socket, the in-memory room correctly—but unhelpfully—counted it as the second peer.
The room-full response happened at signaling time and was not caused by STUN or WebRTC.

### Resolution

The server now issues a random room-scoped resume token to each browser tab. Session storage keeps
the token across reloads without sharing it with a second tab. A returning browser can atomically
replace its own stale socket without opening the room to a third person. Heartbeats were shortened
so genuinely abandoned sockets are removed within about 30 seconds. The surviving peer resets its
old `RTCPeerConnection` and creates a fresh offer when the browser returns.

Some mobile browsers reopen a suspended page as a new tab, which has no session storage. For that
case, the device also retains the latest room token in local storage. A new tab first attempts an
ordinary join; only after the room reports full does it use that token to reclaim the matching
stale slot. This ordering keeps same-browser two-tab testing intact and does not let the token
claim another device's slot.

The interface also explains a genuine room-full response separately from an ICE route failure.
