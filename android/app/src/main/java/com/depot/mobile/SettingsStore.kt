package com.depot.mobile

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Provider credentials and UI preferences, kept in the app's private storage —
 * the same role `settings.json` plays in the desktop build.
 */
class SettingsStore(private val ctx: Context) {

  companion object {
    /** How many resume points to keep before the oldest are dropped. */
    private const val PLAYBACK_KEEP = 50
  }

  private val settingsFile = File(ctx.filesDir, "settings.json")
  private val prefsFile = File(ctx.filesDir, "ui-prefs.json")
  private val playbackFile = File(ctx.filesDir, "playback.json")

  private val settingKeys =
    listOf(
      "googleClientId",
      "googleClientSecret",
      "oneDriveClientId",
      "oneDriveClientSecret",
      "dropboxClientId",
      "dropboxClientSecret",
      "s3Endpoint",
      "s3Region",
      "s3Bucket",
      "s3AccessKeyId",
      "s3SecretAccessKey",
      "torrentDownloadDir",
    )

  @Volatile private var cached: JSONObject? = null

  fun settings(): JSONObject {
    cached?.let {
      return it
    }
    val stored = read(settingsFile)
    val out = JSONObject()
    for (key in settingKeys) out.put(key, stored.optString(key, ""))
    cached = out
    return out
  }

  fun saveSettings(next: JSONObject) {
    val out = JSONObject()
    for (key in settingKeys) out.put(key, next.optString(key, ""))
    settingsFile.writeText(out.toString())
    cached = out
  }

  fun get(key: String): String = settings().optString(key, "")

  fun uiPrefs(): JSONObject = read(prefsFile)

  fun saveUiPrefs(next: JSONObject) {
    prefsFile.writeText(next.toString())
  }

  /** Where the player left off in one file, or null if it was never played. */
  fun playback(path: String): JSONObject? = read(playbackFile).optJSONObject(path)

  /**
   * Remembers a resume point. The player writes every few seconds, so the map is
   * trimmed to the [PLAYBACK_KEEP] most recently touched paths on every save.
   */
  fun savePlayback(path: String, position: Double, duration: Double) {
    val all = read(playbackFile)
    all.put(
      path,
      JSONObject().put("position", position).put("duration", duration).put("at", System.currentTimeMillis()),
    )
    playbackFile.writeText(trimPlayback(all).toString())
  }

  fun forgetPlayback(path: String) {
    val all = read(playbackFile)
    if (!all.has(path)) return
    all.remove(path)
    playbackFile.writeText(all.toString())
  }

  /** Keeps the newest entries by `at`, so the file cannot grow without bound. */
  private fun trimPlayback(all: JSONObject): JSONObject {
    if (all.length() <= PLAYBACK_KEEP) return all
    val newest =
      all.keys()
        .asSequence()
        .sortedByDescending { all.optJSONObject(it)?.optLong("at") ?: 0L }
        .take(PLAYBACK_KEEP)
        .toSet()
    val out = JSONObject()
    for (key in newest) out.put(key, all.get(key))
    return out
  }

  /** Where Drive downloads and torrent output land when nothing is configured. */
  fun downloadDir(): File {
    val configured = get("torrentDownloadDir").trim()
    if (configured.isNotEmpty()) {
      val dir = File(configured)
      if (dir.isDirectory || dir.mkdirs()) return dir
    }
    val downloads =
      File(android.os.Environment.getExternalStorageDirectory(), "Download")
    if (downloads.isDirectory || downloads.mkdirs()) return downloads
    return ctx.filesDir
  }

  private fun read(file: File): JSONObject =
    try {
      if (file.exists()) JSONObject(file.readText()) else JSONObject()
    } catch (_: Exception) {
      JSONObject()
    }
}
