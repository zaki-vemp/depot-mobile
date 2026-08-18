# Depot Mobile

Android file explorer for [Depot](https://github.com/zaki-vemp/depot-desktop): the same local file operations, cloud drives, previews, torrents, and a code workspace, with a React Native UI and a **shared C++ core**.

iOS is scaffolded by React Native but not wired yet. Desktop can later link the same `native/core` library over FFI so listing, copy, move, trash, git, the pty and transfers stay in one place.

## Why C++

The desktop app talks to Rust through Tauri. On Android the equivalent work belongs in native code, not JavaScript:

- directory listing and metadata
- mkdir / create file / rename / copy / move / delete / write
- recursive name search
- trash (app-managed recycle folder) and empty-trash
- disk usage (`statvfs`)
- chunked copy/move with progress (512 KB, same idea as desktop)
- git status / stage / commit via the system `git` binary (same contract as desktop)
- a real posix pty for the in-app terminal (`/system/bin/sh`)

React Native only draws the UI and calls `DepotCore.call(method, json)`.

```
src/                     React Native UI (TypeScript)
native/core/             Shared C++ library (C ABI) — files, transfers, git, pty
android/.../cpp/         JNI glue → libdepot_jni.so
android/.../java/        Kotlin: Drive, torrents, Office, PDF, WebView, intents
```

## Requirements

| | |
|---|---|
| Node.js | 22.11 or newer |
| JDK | 17 or 21 |
| Android SDK | API 36, NDK 27 (the versions in `android/build.gradle`) |
| Device / emulator | Android 7+; Android 11+ needs **All files access** |
| git (optional) | On `PATH` for the source-control panel |

## Run

```bash
npm install
npm start                 # Metro, in one terminal
npm run android           # in another, with an emulator or device
```

First launch asks for all-files access (Settings → Depot → Files). Without that, scoped storage hides most of `/storage/emulated/0`.

## What works on Android today

- Places: internal storage, Download, Documents, Pictures, DCIM, Music, Movies, extra volumes under `/storage`, app trash
- List and grid views, filter, recursive subfolder search, hidden-file toggle, light/dark theme
- New folder, new file, rename, duplicate, copy, cut, paste as tracked transfers
- Trash (moves into the app trash directory), empty trash, permanent delete
- Google Drive: multi-account PKCE, list, mkdir, rename, trash, quota, local ↔ Drive transfers
- Image / text / PDF / Office (xlsx, ods, docx, odt, pptx, odp, csv, tsv) / audio / video previews
- Media player with a folder queue: next/prev through the siblings of the folder
  a file was opened from, repeat off/one/all, shuffle, a queue sheet, drag
  gestures for seek, volume and brightness, resume points, and picture-in-picture
- Background audio with a lockscreen transport; a photo folder reads as a gallery
  with swipe, pinch-zoom and a filmstrip
- In-app website tabs and Facebook / Instagram app tabs (native WebView) — a
  Chrome user agent, uploads and camera capture, in-page fullscreen video,
  pull-to-refresh, and hand-off to the installed app when there is one
- Magnet / `.torrent` downloads over trackers **and the DHT** (no search, no indexer)
- On-device OCR in the image viewer: pull the text out of a receipt or a
  screenshot, copy it, or keep it as a `.txt` beside the picture
- Code workspace: explorer tree, editable buffers written back through C++, git source control, pty terminal
- Nearby sharing: send files and whole folders to another phone running Depot on
  the same Wi-Fi, with no account, no server and no internet
- Open-with / share via the system

Not on mobile (desktop-only): Monaco, libvlc overlay, agent CLI chat. Video uses ExoPlayer instead of VLC.

Downloads started from a web page are saved into the Download folder with the
page's cookies, so they land somewhere the file list can see. `blob:` URLs are
generated inside the page and have no server to fetch from, so those still go
out to Android's own handler.

The torrent client speaks to trackers and to the DHT, so a magnet with no `tr=`
parameters still finds a swarm. It is a leaf node: it never accepts incoming
connections, so it deliberately does not `announce_peer` — advertising a port
nothing listens on would hand every other client a dead address. BitTorrent v2
(`urn:btmh:`) links are not supported.

### Nearby sharing

A UDP beacon on the local network finds other devices; the files themselves go
over a plain TCP stream, so there is no account, no relay and no internet leg.
Long-press anything in the file list and choose **Send to a nearby device**;
folders keep their structure and land in `Download/Depot from <device>`.

**The transfer is not encrypted.** Anyone who can watch traffic on that network
can read the contents. This is a stated limitation, not an oversight — doing it
properly means TLS with a self-signed certificate pinned to a fingerprint in the
beacon, and shipping crypto that has never run on a real handset risks failing
open, which is worse than a limit you can see. Use it on networks you trust.

Two things it does guarantee: nothing is written until the person receiving it
accepts a named offer showing the sender and the full file list, and every path
in that offer is forced to stay inside the destination folder — absolute paths,
`..` and drive letters are refused rather than rewritten.

OCR runs entirely on the device through ML Kit's bundled Latin model: no
network, no Play Services, nothing about the picture leaves the phone. That
costs roughly **10 MB of native code per ABI** plus ~1.5 MB of model assets, so
ship a per-ABI split or an App Bundle rather than a universal APK. Swapping
`com.google.mlkit:text-recognition` for
`com.google.android.gms:play-services-mlkit-text-recognition` moves the model
into Play Services and drops that weight, at the cost of requiring Play Services
and a first-run download.

## Talking to the C++ core

From TypeScript:

```ts
import { api } from './src/api';

const entries = await api.listDir('/storage/emulated/0/Download');
await api.startTransfer(id, from, to, 'copy');
await api.writeText('/storage/emulated/0/Notes/todo.txt', 'buy milk\n');
```

From any other host (future Tauri / iOS):

```c
#include "depot/core.h"

depot_configure("/storage/emulated/0", "/data/user/0/com.depot.mobile/files/trash");
char* json = depot_call("listDir", "{\"path\":\"/storage/emulated/0\"}");
depot_free(json);
```

## Project layout

```
native/core/include/depot/core.h   C ABI
native/core/src/files.cpp          listing, places, copy/move/trash, write, search
native/core/src/transfers.cpp      chunked copy with progress
native/core/src/git.cpp            git spawn (status, stage, commit)
native/core/src/terminal.cpp       posix pty
native/core/src/api.cpp            JSON command dispatcher
android/.../ShareEngine.kt         LAN discovery + file transfer between devices
android/.../Dht.kt                 BEP 5 DHT — finds peers for trackerless magnets
android/.../OcrReader.kt           ML Kit text recognition, bundled and offline
android/app/src/main/cpp/          JNI
src/App.tsx                        mobile shell
src/api.ts                         JS wrappers (mirrors desktop src/api.ts)
src/views/CodeEditor.tsx           workspace tab
src/views/MediaPlayer.tsx          player: folder queue, gestures, resume, PiP
src/views/WebPane.tsx              browser tabs and the social app tabs
```

## License

[MIT](LICENSE) © 2026 Syed Zakiuddin
