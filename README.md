# Discord Clipboard Send for Stream Deck

One key that sends **whatever you just copied** (files, an image or text) to **a list of Discord people and channels**. Tap to send, double-tap to send it as a spoiler, with an optional "are you sure?" first.

Made for showing finished commissions to the same 8–10 people without opening every DM, dragging the image in, ticking spoiler and hitting send over and over.

This is the **Stream Deck side**. It needs the [Vencord Clipboard Send Deck](https://github.com/CaviarTheCatgirl/vencord-clipboard-send) plugin in Discord.

![Stream Deck](https://img.shields.io/badge/Stream%20Deck-Plugin-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- 📋 **Copy, press, done**: files from Explorer / Finder, a copied image, or text
- 👥 **People and channels on one key**: DMs, server channels, threads and group DMs, as many as you like
- 🙈 **Spoiler with a double tap** (or whichever gesture you choose)
- 🎛️ **Every gesture is yours to set**: tap, double tap and hold can each *Send*, *Send as spoiler*, *Send, ask in Discord first*, *Show what's on the clipboard* or do *Nothing*
- ✅ **Confirmation, your way**: press the key again, ask in Discord (preview + untick people + spoiler switch), both, or neither, optionally only from N targets on
- ✏️ **Optional message** with `{name}` and friends, optional silent sending
- 📊 **Live progress on the key** and a per-target report (with **Retry failed**) in the settings
- ✋ **Hold to cancel**, at the question or in the middle of sending

## Requirements

- **Elgato Stream Deck** software **6.9** or newer (Windows 10+ / macOS 12+)
- **Discord desktop app** with [**Vencord**](https://vencord.dev/) built from source
- The [**Vencord Clipboard Send Deck**](https://github.com/CaviarTheCatgirl/vencord-clipboard-send) plugin installed and enabled

## Installation

1. Download the latest `com.caviarthecatgirl.clipboard-send.streamDeckPlugin` from [Releases](https://github.com/CaviarTheCatgirl/streamdeck-clipboard-send/releases/latest).
2. Double-click it. The Stream Deck software installs it.
3. **Clipboard Send** appears under **Discord** in the actions list.

## Setup

1. **Install the Vencord plugin first** ([guide](https://github.com/CaviarTheCatgirl/vencord-clipboard-send#installation)), then restart Discord fully.
2. Drag **Clipboard Send** onto a key.
3. Under **Send to**, add targets:
   - **People** tab: click people from *Recent DMs*, *In your call*, *You talk to most*; search finds your friends. Each group has **Add all**.
   - **Channels** tab: *This channel*, *Recent channels* (the last one you used in each server) and *Group DMs*; search by channel or server name (`art share` finds `#share` in *Art Club*).
   - Or **paste** user IDs, channel IDs or channel links, several at once (spaces, commas or new lines).
4. The status line should say **Connected to Discord** and show your upload limit.

## Usage

Copy something, press the key. With the defaults:

| Gesture | Default |
|---|---|
| **Tap** | Send |
| **Double tap** | Send as spoiler |
| **Hold** (0.5 s) | Show what's on the clipboard, on the key |

Confirmation (default: press the key again):

- The key turns amber: **Send to 9?**, what it found (*2 files*, *Image*, *Text, 120 chars*) and a countdown ring. **Press** to send, **hold** to cancel, or let it run out.
- With **Ask in Discord**, Discord comes to the front and shows a preview of what you copied and everyone it's going to: untick people, switch spoiler on, then **Send**.

While sending, the key shows `3 / 9` with a progress bar. **Hold** stops it (whoever already got it keeps it). At the end it shows a green check, or how many failed; the settings panel says who and why.

> A single tap waits for the double-tap window (300 ms) to tell a tap from a double tap. Set **Double tap** to *Nothing* and taps fire instantly.

## Settings

### Send to
People and channels, as chips; ✕ removes one, **Remove all** (click twice) empties the key.

### Message

| Setting | Default | What it does |
|---|---|---|
| Send a message with it | Off | Off = only the clipboard content goes out |
| Message | *(empty)* | `{name}` `{username}` `{mention}` `{count}` `{date}` `{time}`. In channels `{name}` is the channel name and `{mention}` stays empty. Goes with the first message to each target. |

### What to send

| Setting | Default | |
|---|---|---|
| From the clipboard | Files, else image, else text | · Only files or an image · Only text |
| Check what's on the clipboard | | Shows what the key would send right now |

Files go up as they are (10 per message, more files = more messages). A copied image goes up as a PNG. Text longer than Discord allows (2000, or 4000 with Nitro) is sent as `message.txt`.

### Key gestures

Tap, Double tap and Hold each: *Send* · *Send as spoiler* · *Send, ask in Discord first* · *Show what's on the clipboard* · *Nothing*.

### Confirmation

| Setting | Default | |
|---|---|---|
| Press the key again to send | On | |
| Ask in Discord | Off | Both on: the key asks first, then Discord |
| Only when sending to | always | Ask only from N targets on |
| Time to press again | 5 s | 2 – 15 s |
| Bring Discord to the front for the question | On | |

A gesture set to *Send, ask in Discord first* always shows Discord's dialog, whatever the switches say. Handy as **Hold** for "let me double-check this one".

### Sending

| Setting | Default | |
|---|---|---|
| Send silently | Off | No push notification for the people / channel |
| Pause between people | 1.5 s | 0.5 – 15 s (Vencord's *Min delay* is the floor) |

### Key

| Setting | Default | |
|---|---|---|
| Show a label on the key | On | |
| Label | who it goes to | e.g. *Amy*, *9 people*, *3 channels*, *12 chats* |

### Last send

What the key sent last, to whom, and for each target ✓ / ✕ with the reason. **Stop** while running, **Retry failed** afterwards (within 15 minutes; the copied content is kept that long).

### Timing / Connection

Hold after (500 ms), double-tap window (300 ms); port (37322, must match the Vencord plugin).

## Troubleshooting

### Keys show "Discord off"
Discord isn't running, **ClipboardSendDeck** isn't enabled in Vencord, or the ports don't match.

### "Clipboard is empty"
Nothing this key sends is on the clipboard: check **From the clipboard** (an *Only text* key ignores images and files).

### "Too big for your limit"
A file is over your upload limit (10 MB without Nitro). In boosted servers the higher server limit applies, so it may still reach those channels.

### Somebody always fails
The reason is in **Last send**: closed DMs, no permission in a channel, a forum (use a thread link) or a captcha Discord wants for a brand-new DM (open that DM by hand once).

## Development

```bash
git clone https://github.com/CaviarTheCatgirl/streamdeck-clipboard-send.git
cd streamdeck-clipboard-send

npm ci
npm run build     # bundles src/ → com.caviarthecatgirl.clipboard-send.sdPlugin/bin/plugin.js
npm run watch     # rebuild on change + restart the plugin in Stream Deck
streamdeck link com.caviarthecatgirl.clipboard-send.sdPlugin
streamdeck pack com.caviarthecatgirl.clipboard-send.sdPlugin
```

```
streamdeck-clipboard-send/
├── src/
│   ├── plugin.ts                # entry: registers the action, port from global settings
│   ├── bridge.ts                # JSON calls to Discord, online check every 4 s while keys are visible
│   ├── render.ts                # key images (SVG) for every state
│   └── actions/
│       └── clipboard-send.ts    # gestures, confirmation, progress, settings panel messages
├── com.caviarthecatgirl.clipboard-send.sdPlugin/
│   ├── manifest.json
│   ├── ui/clipboard-send.html   # settings panel
│   └── imgs/
├── rollup.config.mjs
└── package.json
```

## License

MIT

## Credits

**Created by**: CaviarTheCatgirl

**Related projects**:
- [Vencord Clipboard Send Deck](https://github.com/CaviarTheCatgirl/vencord-clipboard-send): required Discord plugin
- [Discord User Volume for Stream Deck](https://github.com/CaviarTheCatgirl/streamdeck-user-volume): one person's volume on a key or dial

## Changelog

### v1.0.0 (initial release)

- ✨ Clipboard Send action: files, image or text to many people and channels
- 🎛️ Configurable tap / double tap / hold, incl. spoiler and ask-in-Discord gestures
- ✅ Optional key and / or Discord confirmation, optionally only from N targets
- ✏️ Optional message with placeholders, silent sending
- 📊 Progress on the key, per-target report, stop and retry
