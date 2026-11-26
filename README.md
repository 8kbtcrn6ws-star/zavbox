# Zavbox

Zav's game library for a TV. Open `index.html` from a local web server or from GitHub Pages, put the page full screen on the TV, and scan the QR code with a phone. The phone becomes a controller for this menu (D-pad, A, B, Home). Keyboard arrows, Enter, Escape and a mouse also work on the TV.

```
python3 -m http.server 4173 --bind 127.0.0.1 --directory /workspace/zavbox
```

Then open http://127.0.0.1:4173/ on the TV, and the QR code opens `controller.html` on a phone.

## What Play does

The shelf currently holds Party Mode only. Play opens the live game on this TV:

https://8kbtcrn6ws-star.github.io/party-mode/

On that screen, choose Party Mode, then scan the QR code it shows with your phone to drive. The Zavbox controller steps aside once the game starts. Party Mode itself is not modified.

## Phone link

The TV and phone use the same approach as Party Mode: the free public PeerJS broker and Google STUN. There is no paid service and no account. If the connection service is unreachable, the TV still works with a keyboard or mouse.

## Library data

Shared games live in `games.json`. Do not add a card without a real game behind Play.

A future game can only be added if it supports the same living-room setup:

- The TV launches the game from Zavbox.
- After launch, the game can be played with a phone as the controller, the way Party Mode does with its own QR code.
- The Zavbox menu itself is always driven with a simple D-pad plus A, B and Home.

```
node scripts/add-game.mjs --id my-game --title "My Game" --description "A short accurate description." --url https://example.com/game --cover /path/to/cover.webp
```

For a local folder instead of a URL, use `--dir /path/to/runnable-build`. That only suits a small, self-contained game with an `index.html`. Do not copy private folders, secrets or tests.

## Add a game only on this device

The Add Game tile saves a title, play URL and description to `localStorage`, and an optional cover image URL. If you skip the cover, the card uses a coloured gradient. That entry stays in this browser. It is not part of the shared `games.json`.

## What this repo does not include

Party Mode is not copied here. Play opens the live site. Private folders, password files and test suites from other projects stay out of Zavbox.
