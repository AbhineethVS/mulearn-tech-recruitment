# P4Pair design system

P4Pair should look like a clear network instrument without becoming a dark developer console. The
defining visual is a line joining two visible endpoints. Borders and rails explain structure; they
are not decoration.

## Tokens

- Canvas `#edf0ef`, paper `#f8faf8`, ink `#142023`
- Muted text `#617073`, divider `#cfd7d5`, strong divider `#aab7b5`
- Route blue `#2755d9`, connected green `#08785e`, negotiating amber `#a75d05`
- Error red `#b53c36`; every status color must also have a text label
- Interface: Familjen Grotesk 400–700; network identifiers: DM Mono 400–500
- Square corners by default; circles are reserved for peers and connection-status nodes

## Composition

The landing page places the explanation and live route illustration before the room controls. The
conversation uses three horizontal layers: global room controls, a connection rail, and the
message workspace. Private rooms retain the defining two-endpoint line. Group rooms replace it
with a compact four-place participant instrument without imitating a social-media contact list.
Desktop adds a narrow local diagnostics timeline; mobile removes it before reducing conversation
width.

The memorable element is the route itself. Do not add decorative gradients, floating shapes, or a
collection of unrelated cards.

## Interaction floor

- Controls are at least 44 px where layout allows
- Keyboard focus is visible on every interactive element
- Connection changes use text, icon, and color together
- Waiting, connecting, connected, disconnected, and failed states each explain the next action
- On desktop Enter sends and Shift+Enter adds a line; touch keyboards keep Enter for new lines
- Peer text wraps safely and is never rendered as HTML
- Reduced motion disables the loading rotation and nonessential transitions
- The interface has no horizontal overflow at 375 px
- Invitation QR codes live in one structural dialog/bottom sheet with native Share and copy
  fallback; the QR is functional content, not decoration
- Private voice calls keep the conversation visible: incoming consent uses a focused dialog, while
  ringing and active states use a compact structural bar with duration, route quality, mute, and
  hang-up controls
- Private video calls use the same consent dialog and a restrained 16:9 stage above the message
  thread. The remote view stays primary; the local preview is a small labelled inset. Camera,
  microphone, camera-switch, autoplay recovery, and hang-up controls remain at least 44 px on
  mobile, and a camera-off state always has a text placeholder
- At 375 px the stage must not create horizontal overflow or hide the message thread below it
- Live call and voice-note capture are mutually exclusive, and blocked remote autoplay exposes a
  visible Play audio recovery action

## Voice

Use short, factual language: “Create a room”, “Waiting for peer”, “Direct channel open”, and “Try
again”. Avoid claiming anonymous communication, permanent privacy, or authenticated end-to-end
identity. “Encrypted in transit” is accurate for the current WebRTC implementation.
