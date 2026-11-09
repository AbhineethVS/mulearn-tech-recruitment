# P4Pair agent guide

Read the relevant rule in `.cursor/rules/` before changing code. Keep this file short; detailed
decisions live in `docs/`.

## Product contract

- Build for MuLearn Task 01; reliable two-peer text chat outranks bonus features.
- Chat messages and file contents must travel through WebRTC data channels, never signaling.
- The Node/WebSocket server may exchange room membership, SDP, and ICE candidates only.
- Keep rooms ephemeral and usable without accounts or a database. Private rooms hold two peers;
  text-only group rooms hold at most four.
- Describe STUN and TURN accurately; never claim that STUN guarantees connectivity.

## Quality gates

Run `npm run check` before handoff. For UI changes, verify 375 px and desktop widths, keyboard
focus, reduced motion, waiting/error states, and text wrapping. For networking changes, test two
isolated private pages plus three/four-page groups, disconnect handling, candidate ordering, and
signaling payload validation.

## Reference map

- `docs/ARCHITECTURE.md` — data flow and implementation decisions
- `docs/DESIGN_SYSTEM.md` — visual direction and UI constraints
- `shared/protocol.ts` — source of truth for signaling messages
- `.agents/skills/` — reusable project-pinned design, testing, and platform skills
