# TalkBack design notes

## North star

TalkBack is a calm local chat kiosk: private by default, warm in tone, and easy to use at arm's length.

## Visual language

- **Palette:** deep green-black `#101B1D`, raised slate `#1A292B`, fine divider `#2B3B3C`, soft paper `#F2F0E9`, sage `#A8D6BD`, and signal coral `#EF9879`.
- **Type:** Georgia for a few human, editorial headings; Segoe UI and system sans-serif for controls and conversation text.
- **Layout:** a narrow device/privacy rail beside one roomy conversation area; on small screens the rail becomes a compact brand header.
- **Signature:** three soft waveform bars, with the center bar in coral, echo the local audio assistant without promising speech features in this milestone.

## Interaction rules

- Chat and model discovery use same-origin TalkBack endpoints; the backend connects only to an Ollama loopback address.
- Show connection, loading, and failure states in text as well as color.
- Preserve a failed message in the composer so it can be corrected or retried.
- Controls remain keyboard accessible and sized for touch use.

