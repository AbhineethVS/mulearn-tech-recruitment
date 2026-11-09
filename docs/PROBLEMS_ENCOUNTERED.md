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
- Use managed TURN when a direct route is impossible.

### Product improvement

The original generic “connection failed” message did not help a reviewer recover. P4Pair now keeps
track of local and remote ICE candidate evidence. If both peers advertise host candidates in the
same private subnet but ICE still fails, the interface reports **“Likely local-network isolation”**
and suggests non-guest Wi-Fi, disabling AP/client isolation, checking endpoint firewalls, or using
the laptop's mobile hotspot.

This is deliberately described as “likely,” not certain. Browser JavaScript cannot run ARP or ping
tests, so it cannot distinguish router isolation from every possible endpoint firewall. Other
candidate patterns receive different guidance, including missing peer candidates, a blocked direct
route without TURN, or failure of both direct and relayed routes.

### Why TURN is still useful

P4Pair always allows ICE to try direct host and STUN-discovered routes first. TURN is a fallback for
networks where those routes cannot work. A TURN session still uses WebRTC and DTLS encryption, but
its packets are relayed, so the UI and documentation must not describe that route as physically
direct.

For the core project demonstration, a network that permits direct communication should be used.
TURN demonstrates reliability across restrictive networks as an additional capability.

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
