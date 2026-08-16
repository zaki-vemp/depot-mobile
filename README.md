# Depot Mobile

Android file explorer for [Depot](https://github.com/zaki-vemp/depot-desktop): the same local file operations, now with a React Native UI and a **shared C++ core**.

iOS is scaffolded by React Native but not wired yet. Desktop can later link the same `native/core` library over FFI so listing, copy, move, trash and transfers stay in one place.

## Why C++

The desktop app talks to Rust through Tauri. On Android the equivalent work belongs in native code, not JavaScript:

- directory listing and metadata
- mkdir / rename / copy / move / delete
- trash (app-managed recycle folder)
- disk usage (`statvfs`)
- chunked copy/move with progress (512 KB, same idea as desktop)

React Native only draws the UI and calls `DepotCore.call(method, json)`.

```
src/                     React Native UI (TypeScript)
native/core/             Shared C++ library (C ABI)
android/.../cpp/         JNI glue → libdepot_jni.so
android/.../java/        Kotlin NativeModule + storage permission + share/open
```

## Requirements

| | |
|---|---|
| Node.js | 22.11 or newer |
| JDK | 17 or 21 |
| Android SDK | API 36, NDK 27 (the versions in `android/build.gradle`) |
| Device / emulator | Android 7+; Android 11+ needs **All files access** |

## Run

```bash
npm install
npm start                 # Metro, in one terminal
npm run android           # in another, with an emulator or device
```

First launch asks for all-files access (Settings → Depot → Files). Without that, scoped storage hides most of `/storage/emulated/0`.

## What works on Android today

- Places: internal storage, Download, Documents, Pictures, DCIM, Music, Movies, extra volumes under `/storage`, app trash
- List and grid views, filter, hidden-file toggle, light/dark theme
- Open folders, image preview, text preview, open-with / share via the system
- New folder, rename, copy, cut, paste as tracked transfers
- Trash (moves into the app trash directory) and permanent delete

Not ported yet (desktop still has these): Google Drive, torrents, VLC, Office extract, in-app web tabs.

## Talking to the C++ core

From TypeScript:

```ts
import { api } from './src/api';

const entries = await api.listDir('/storage/emulated/0/Download');
await api.startTransfer(id, from, to, 'copy');
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
native/core/src/files.cpp          listing, places, copy/move/trash, disk
native/core/src/transfers.cpp      chunked copy with progress
native/core/src/api.cpp            JSON command dispatcher
android/app/src/main/cpp/          JNI
src/App.tsx                        mobile shell
src/api.ts                         JS wrappers (mirrors desktop src/api.ts)
```

## License

[MIT](LICENSE) © 2026 Syed Zakiuddin
