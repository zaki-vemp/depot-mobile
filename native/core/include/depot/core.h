#pragma once

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/** Configure platform roots. `home` is internal storage; `trash` is the recycle folder. */
void depot_configure(const char* home, const char* trash);

/**
 * JSON-in / JSON-out command surface shared by Android JNI, a future iOS
 * wrapper, and (later) the desktop Tauri host via FFI.
 *
 * Returns a heap string that must be freed with `depot_free`.
 * Shape: `{"ok":true,"data":...}` or `{"ok":false,"error":"..."}`.
 */
char* depot_call(const char* method, const char* args_json);

void depot_free(char* ptr);

typedef void (*depot_transfer_cb)(const char* json, void* user);

/** Chunked copy/move. Progress JSON matches the desktop `transfer` event. */
void depot_start_transfer(const char* id, const char* from, const char* to, const char* op,
                          depot_transfer_cb cb, void* user);

/** Asks a running transfer to stop at its next chunk boundary. */
void depot_cancel_transfer(const char* id);

#ifdef __cplusplus
}
#endif
