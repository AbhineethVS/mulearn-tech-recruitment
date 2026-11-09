# Pairly visual source of truth

## Direction

A calm peer-to-peer network instrument. The visible route between two endpoint circles is the one
recognizable motif. The rest of the interface stays square, typographic, and restrained.

## Palette

- `--ink: #142023`
- `--muted: #617073`
- `--paper: #f8faf8`
- `--canvas: #edf0ef`
- `--line: #cfd7d5`
- `--line-strong: #aab7b5`
- `--blue: #2755d9`
- `--green: #08785e`
- `--amber: #a75d05`
- `--red: #b53c36`

## Type

Familjen Grotesk carries all interface and editorial copy. DM Mono is limited to room codes,
timestamps, peer identifiers, and protocol labels. Headlines use tight tracking and compact line
height; body copy stays below 80 characters per line.

## Layout

- Landing: explanatory field plus one bordered room-control panel
- Connected: 70 px header, 82 px route rail, conversation with 320 px diagnostics at desktop
- Mobile: compact header, route rail, conversation; diagnostics hidden below 900 px
- Structural borders replace general-purpose shadows and rounded cards

## States

- Quiet: neutral gray
- Negotiating: amber plus active text
- Connected: green plus “Direct channel open”
- Failed/disconnected: red plus recovery action

## Avoid

No decorative gradients, glass effects, emoji icons, oversized dashboard metrics, generic chat
avatars, or color-only status. Do not turn the diagnostics timeline into raw SDP or ICE output.
