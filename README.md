# Foldback Chat

[Українською](README.uk.md)

Twitch and YouTube chat in one window over your game. Only you see it: OBS captures the game itself, other windows
never get into the stream (the game has to run in a borderless window, not in exclusive fullscreen).

## Download
[Releases](https://github.com/Fenderenko/FoldbackChat/releases/latest): `FoldbackChat-<version>.zip` (the app, license,
this file) or the bare `FoldbackChat-<version>.exe`. No installer: run the exe. Windows 10 / 11 with Microsoft Edge
WebView2 Runtime (already part of Windows 11).

## Start
Run `FoldbackChat.exe` — an icon appears in the tray. Click it to show / hide the chat, right-click for the menu.

## Hotkeys (change them in the settings)
- **Alt+Shift+C** — show / hide the chat
- **Alt+Shift+X** — lock / unlock. An unlocked chat can be dragged, resized by its edges and scrolled back with the
  mouse wheel; a locked one lets clicks through to the game.
- **Alt+Shift+S** — settings

## Features
- Twitch (as a guest, no password) and YouTube (no keys; the live stream is found by itself)
- Twitch, 7TV, BTTV, FFZ emotes and YouTube emoji
- highlights for mentions, your own words, first-timers, moderators, subs, raids, bits, Super Chats, channel points
- replies (who and what), own colours and marks for viewers
- a sound for every kind of event: built-in or your own file, volume, a pause between sounds
- look: cards or lines, fonts (any font installed in Windows), text size, transparency, colours, how many messages
  and when they fade
- name colour palettes: ready-made, your own, generated
- filters: bots, commands, links, ignored people
- top line: channel status, viewers, stream time, clock — size, colour and backing adjustable
- a separate chat position for every fullscreen game; "With OBS" mode — the chat shows while OBS runs
- languages: English, Ukrainian, German, French, Spanish, Portuguese, Polish, Italian, Turkish
- sends the YouTube chat to OBS browser sources (SSE `http://127.0.0.1:8792/events`) while the app is open

Settings are kept in `%LOCALAPPDATA%\Foldback Chat`; the window position, hotkeys and per-game positions in
`%APPDATA%\Foldback Chat`.

## Build
Rust (MSVC), the app itself: `src/` (Rust) and `web/` (the chat and settings pages, HTML / CSS / JavaScript).
```
cargo build --release
copy target\release\FoldbackChat.exe FoldbackChat.exe
```
Python is needed only for the helper scripts in `tools/`: `mkicon.py` draws the icons (`assets/`), `i18n_src.py` holds
the translations and generates `web/i18n.js`, `check_i18n.py` checks them. Their results are in the repository, so the
build doesn't need Python.

## License
GPL-3.0 — see [LICENSE](LICENSE).
