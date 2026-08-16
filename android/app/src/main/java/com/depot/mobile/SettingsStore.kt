package com.depot.mobile

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Provider credentials and UI preferences, kept in the app's private storage —
 * the same role `settings.json` plays in the desktop build.
 */
class SettingsStore(private val ctx: Context) {

  private val settingsFile = File(ctx.filesDir, "settings.json")
  private val prefsFile = File(ctx.filesDir, "ui-prefs.json")

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
