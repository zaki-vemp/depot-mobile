package com.depot.mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.URLUtil
import java.io.File

/**
 * Saving a file out of a web page into Depot's own download folder.
 *
 * The WebView used to hand every download straight to Android with a bare
 * `ACTION_VIEW`, which loses the session: a photo behind a login is served only
 * to a request carrying the page's cookies, so the receiving app got an error
 * page. `DownloadManager` can carry those headers, and pointing it at
 * [SettingsStore.downloadDir] means the result shows up in the file list
 * instead of somewhere the app cannot see.
 */
object Downloads {

  /**
   * Queues [url] for download and returns where it will land.
   * Throws when the URL is not something `DownloadManager` can fetch — `blob:`
   * and `data:` URLs are generated inside the page and have no server to ask.
   */
  fun save(ctx: Context, url: String, userAgent: String?, disposition: String?, mime: String?): File {
    require(url.startsWith("http://") || url.startsWith("https://")) {
      "Only http(s) downloads can be saved into Depot"
    }
    val dir = SettingsStore(ctx).downloadDir()
    val name = unique(dir, URLUtil.guessFileName(url, disposition, mime))
    val request =
      DownloadManager.Request(Uri.parse(url))
        .setTitle(name)
        .setDescription("Saving to Depot")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationUri(Uri.fromFile(File(dir, name)))
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    userAgent?.let { request.addRequestHeader("User-Agent", it) }
    mime?.takeIf { it.isNotBlank() }?.let { request.setMimeType(it) }

    val manager =
      ctx.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        ?: throw IllegalStateException("This device has no download manager")
    manager.enqueue(request)
    return File(dir, name)
  }

  /** `photo.jpg`, `photo-2.jpg`, … so a second save never clobbers the first. */
  private fun unique(dir: File, name: String): String {
    if (!File(dir, name).exists()) return name
    val stem = name.substringBeforeLast('.', name)
    val ext = name.substringAfterLast('.', "")
    var n = 2
    while (true) {
      val next = if (ext.isEmpty()) "$stem-$n" else "$stem-$n.$ext"
      if (!File(dir, next).exists()) return next
      n += 1
    }
  }
}
