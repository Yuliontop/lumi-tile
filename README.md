# Lumi Tile

A [Lumiverse](https://github.com/prolix-oc/Lumiverse) extension that puts **up to four chats on screen at once**.

Each tile is a real Lumiverse chat, so it looks and works exactly like the normal one: type, swipe, edit, regex, HTML cards and other extensions all work in every tile. The tile you're using is in full colour; the others are dimmed and keep streaming their replies.

## Features

| | |
|---|---|
| **Layouts** | 2 chats side by side · 3 chats as one wide tile on top or bottom with two side by side · 4 chats as a 2×2 grid |
| **Resize** | Drag the gaps between tiles (or focus a gap and use the arrow keys) |
| **Live tile** | Click anywhere in a tile to make it the live one: full colour with an accent border, the others dimmed |
| **Full screen** | Expand any tile to fill the tiling area; the others stay loaded and keep streaming |
| **Add and close** | **+** in any tile's header picks another character's chat (up to 4); **×** closes a tile. Back to one chat, normal Lumiverse returns |
| **Remembered** | The chats, sizes, wide-tile position, live tile and full screen come back when you reopen Lumiverse |
| **Lumi Flair** | Works with [Lumi Flair](https://github.com/Yuliontop/lumi-flair) 1.7.1+: effects play in the live tile, sounds and theme once, nothing doubles |

## Requirements

- **Lumiverse running on this computer** (the desktop app, or a browser at `localhost` / `127.0.0.1`). Lumiverse doesn't allow itself to be embedded when opened from another address, so tiling is unavailable there.
- **Settings → Account → "Enforce one active browser tab" turned off.** Every tile is its own Lumiverse window, and with that setting on, each new one would take over. Lumi Tile tells you and opens the setting if it's on.
- **A computer.** Tiling is off on phones and tablets.

## Install

1. In Lumiverse, open **Extensions** and install from GitHub: `https://github.com/Yuliontop/lumi-tile`
2. Enable it and grant **App manipulation** (Lumi Tile draws the tiles over the app).
3. Refresh (Ctrl+Shift+R).

## Use

- In a chat, open **Extras** (the message bar) → **Tile another chat** and pick a character. Your chat and theirs appear side by side.
- Each tile's header has **+** (add a chat), **full screen**, **×** (close), and with three chats, **move to top/bottom** or **make this the wide tile**.
- The main Lumiverse window stays underneath, on the live tile's chat, so the side drawer (characters, personas, presets, settings) works on the chat you're using.

## Good to know

- Each tile is a full Lumiverse with all your extensions, so every tile uses about as much memory as another Lumiverse tab.
- If you turn "Enforce one active browser tab" back on after tiling, reload Lumiverse once (it will say the tab is inactive until you do).
- A draft you were typing in a tile is kept if Lumiverse's draft saving is on.

## Development

```
bun install
bun run build      # dist/frontend.js (committed: Lumiverse installs from GitHub without building)
bun run typecheck
bun test
```

Frontend only (no backend bundle). See `src/frontend.ts`.

## License

MIT
