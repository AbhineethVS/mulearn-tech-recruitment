# Boardline master design direction

This file is the persisted UI/UX skill output after reviewing the generated recommendation against
the supplied reference images and product brief. The generated indigo/green palette was rejected
because it did not match the references or Boardline's intended character.

## Direction

Boardline should feel like a well-kept project desk: compact navigation, a quiet neutral canvas,
white working surfaces, precise type, and color reserved for work state. It should not look like a
generic marketing dashboard.

## Tokens

| Role | Value |
| --- | --- |
| Canvas | `#f3f4f6` |
| Surface | `#ffffff` |
| Soft surface | `#f8f8f7` |
| Ink | `#18191c` |
| Muted text | `#6d6d68` |
| Divider | `#e5e5e2` |
| Action accent | `#ff715b` |
| Focus ring | `#6658d3` |

Display and headings use Manrope. Interface text uses DM Sans. Use sentence case throughout.

## Component rules

- Primary buttons are near-black, not brightly colored.
- Cards use one quiet border and minimal shadow; avoid nested card stacks.
- Kanban columns use status tints with explicit text labels.
- Radius follows hierarchy: 9–11px for controls/cards, 14–16px for major panels.
- Use Lucide icons only. Icons never replace an essential text label.
- Mobile Kanban columns stay readable and scroll horizontally.

## Delivery checks

- Visible keyboard focus and semantic controls
- 4.5:1 normal-text contrast
- Reduced-motion support
- Useful empty, loading, disabled, and error states
- No decorative gradients, glass effects, floating shapes, or emoji icons
- Verify 375px, 768px, 1024px, and 1440px widths

See `docs/DESIGN_SYSTEM.md` for rationale and implementation notes.
