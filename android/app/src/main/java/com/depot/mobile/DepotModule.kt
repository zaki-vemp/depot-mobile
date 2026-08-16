package com.depot.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * One JSON bridge for the whole app. Anything Android owns — intents, OAuth,
 * PDF and Office rendering, torrents — is answered here; everything else falls
 * through to the shared C++ core, so `api.ts` sees a single call shape exactly
 * like Tauri's `invoke` on the desktop.
 */
class DepotModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "DepotCore"

  private val settings by lazy { SettingsStore(ctx) }
  private val drive by lazy { DriveClient(ctx, settings) }
  private val torrents by lazy { TorrentEngine(settings) }

  /** File work never runs on the JS thread; the pool keeps listings snappy. */
  private val pool = Executors.newFixedThreadPool(4) { r -> Thread(r, "depot-core") }
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  init {
    val home = Environment.getExternalStorageDirectory().absolutePath
    val trash = File(ctx.filesDir, "trash").absolutePath
    DepotNative.nativeConfigure(home, trash)
    DepotNative.nativeBind(this)
  }

  override fun invalidate() {
    pool.shutdownNow()
    torrents.shutdown()
    super.invalidate()
  }

  /* ── transfer events from C++ ─────────────────────────── */

  fun onTransferNative(json: String) {
    val payload =
      try {
        val obj = JSONObject(json)
        Arguments.createMap().apply {
          putString("id", obj.optString("id"))
          putDouble("moved", obj.optLong("moved").toDouble())
          putDouble("total", obj.optLong("total").toDouble())
          putString("state", obj.optString("state"))
          if (obj.has("error") && !obj.isNull("error")) putString("error", obj.optString("error"))
        }
      } catch (_: Exception) {
        Arguments.createMap().apply { putString("raw", json) }
      }
    emit("transfer", payload)
  }

  private fun emit(event: String, payload: com.facebook.react.bridge.WritableMap) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
  }

  private fun emitTransfer(id: String, moved: Long, total: Long, state: String, error: String?) {
    emit(
      "transfer",
      Arguments.createMap().apply {
        putString("id", id)
        putDouble("moved", moved.toDouble())
        putDouble("total", total.toDouble())
        putString("state", state)
        error?.let { putString("error", it) }
      },
    )
  }

  /* ── bridge ───────────────────────────────────────────── */

  @ReactMethod
  fun call(method: String, args: String, promise: Promise) {
    pool.execute {
      try {
        val parsed = if (args.isBlank()) JSONObject() else JSONObject(args)
        val handled = handle(method, parsed)
        if (handled != null) {
          promise.resolve(JSONObject().put("ok", true).put("data", handled.value).toString())
        } else {
          promise.resolve(DepotNative.nativeCall(method, args))
        }
      } catch (e: Throwable) {
        promise.resolve(
          JSONObject().put("ok", false).put("error", e.message ?: e.toString()).toString(),
        )
      }
    }
  }

  /** Wraps a nullable result so "handled with null" differs from "not mine". */
  private class Handled(val value: Any?)

  private val NULL = Handled(JSONObject.NULL)

  private fun handle(method: String, a: JSONObject): Handled? =
    when (method) {
      /* shell */
      "hasAllFilesAccess" -> Handled(hasAllFilesAccess())
      "openAllFilesSettings" -> {
        startActivity(
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
              .setData(Uri.parse("package:${ctx.packageName}"))
          } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
              .setData(Uri.parse("package:${ctx.packageName}"))
          },
        )
        NULL
      }
      "openInSystem" -> {
        val file = File(a.getString("path"))
        startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uriFor(file), mimeOf(file))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
        )
        NULL
      }
      "revealInSystem" -> {
        val file = File(a.getString("path"))
        val folder = if (file.isDirectory) file else file.parentFile ?: file
        startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uriFor(folder), "resource/folder")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
        )
        NULL
      }
      "sharePath" -> {
        val file = File(a.getString("path"))
        startActivity(
          Intent.createChooser(
            Intent(Intent.ACTION_SEND)
              .setType(mimeOf(file))
              .putExtra(Intent.EXTRA_STREAM, uriFor(file))
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            "Share",
          ),
        )
        NULL
      }
      "openUrl" -> {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.getString("url"))))
        NULL
      }
      "listOpenWith" -> Handled(listOpenWith(a.getString("path")))
      "openWithApp" -> {
        val file = File(a.getString("path"))
        val target = a.getString("app").split('/')
        startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uriFor(file), mimeOf(file))
            .setClassName(target[0], target.getOrElse(1) { "" })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
        )
        NULL
      }
      "pickOpenWith" -> {
        val file = File(a.getString("path"))
        startActivity(
          Intent.createChooser(
            Intent(Intent.ACTION_VIEW)
              .setDataAndType(uriFor(file), mimeOf(file))
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            "Open with",
          ),
        )
        NULL
      }

      /* settings */
      "getSettings" -> Handled(settings.settings())
      "saveSettings" -> {
        settings.saveSettings(a.getJSONObject("settings"))
        NULL
      }
      "getUiPrefs" -> Handled(settings.uiPrefs())
      "saveUiPrefs" -> {
        settings.saveUiPrefs(a.getJSONObject("prefs"))
        NULL
      }

      /* viewers */
      "previewOffice" -> Handled(OfficeReader.preview(a.getString("path")))
      "renderPdf" -> Handled(renderPdf(a.getString("path"), a.optInt("from"), a.optInt("count", 6)))
      "listSubtitles" -> Handled(listSubtitles(a.getString("path")))

      /* drive */
      "listDriveAccounts" -> Handled(drive.list())
      "connectGoogleDrive" -> Handled(drive.connect())
      "disconnectGoogleDrive" -> {
        drive.disconnect(a.getString("accountId"))
        NULL
      }
      "listDrive" ->
        Handled(drive.listFolder(a.getString("accountId"), a.optStringOrNull("folderId")))
      "mkdirDrive" ->
        Handled(
          drive.makeFolder(
            a.getString("accountId"),
            a.optStringOrNull("folderId"),
            a.getString("name"),
          ),
        )
      "cacheDriveFile" -> Handled(drive.cache(a.getString("path"), a.optString("name")))
      "driveQuota" -> Handled(drive.quota(a.getString("accountId")))

      /* torrents */
      "addTorrent" -> Handled(torrents.add(a.getString("magnet")))
      "listTorrents" -> Handled(torrents.list())
      "pauseTorrent" -> {
        torrents.pause(a.getInt("id"))
        NULL
      }
      "resumeTorrent" -> {
        torrents.resume(a.getInt("id"))
        NULL
      }
      "removeTorrent" -> {
        torrents.remove(a.getInt("id"))
        NULL
      }

      else -> null
    }

  /* ── transfers ────────────────────────────────────────── */

  @ReactMethod
  fun startTransfer(id: String, from: String, to: String, op: String, promise: Promise) {
    cancelled.remove(id)
    // Drive legs are HTTP, so they run here; local copies stay in the C++ core.
    if (from.startsWith("gdrive://") || to.startsWith("gdrive://")) {
      pool.execute {
        try {
          runDriveTransfer(id, from, to, op)
          emitTransfer(id, 0, 0, "done", null)
          promise.resolve(null)
        } catch (e: Throwable) {
          emitTransfer(id, 0, 0, "error", e.message ?: e.toString())
          promise.reject("DEPOT", e)
        }
      }
      return
    }
    try {
      DepotNative.nativeStartTransfer(id, from, to, op)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("DEPOT", e)
    }
  }

  @ReactMethod
  fun cancelTransfer(id: String, promise: Promise) {
    cancelled.add(id)
    runCatching { DepotNative.nativeCancelTransfer(id) }
    promise.resolve(null)
  }

  private fun runDriveTransfer(id: String, from: String, to: String, op: String) {
    val fromDrive = from.startsWith("gdrive://")
    val toDrive = to.startsWith("gdrive://")

    if (fromDrive && !toDrive) {
      val (accountId, fileId) = drive.split(from)
      val total = drive.size(accountId, fileId)
      val export = drive.exportMimeFor(accountId, fileId)
      emitTransfer(id, 0, total, "running", null)
      drive.download(accountId, fileId, export, File(to)) { moved, reported ->
        if (cancelled.contains(id)) throw InterruptedException("Cancelled")
        emitTransfer(id, moved, if (reported > 0) reported else total, "running", null)
      }
      return
    }

    if (!fromDrive && toDrive) {
      // gdrive://<account>/<folder>/<url-encoded name>
      val rest = to.removePrefix("gdrive://").split('/')
      val accountId = rest[0]
      val folderId = rest.getOrElse(1) { "root" }
      val name = Uri.decode(rest.getOrElse(2) { File(from).name })
      val source = File(from)
      if (source.isDirectory) throw IllegalArgumentException("Upload folders one file at a time")
      emitTransfer(id, 0, source.length(), "running", null)
      drive.upload(accountId, folderId, name, source) { moved, total ->
        if (cancelled.contains(id)) throw InterruptedException("Cancelled")
        emitTransfer(id, moved, total, "running", null)
      }
      return
    }

    // Drive → Drive: stage through the cache so one code path covers every route.
    val (accountId, fileId) = drive.split(from)
    val staged = File(ctx.cacheDir, "xfer-$id")
    try {
      val export = drive.exportMimeFor(accountId, fileId)
      drive.download(accountId, fileId, export, staged) { moved, total ->
        if (cancelled.contains(id)) throw InterruptedException("Cancelled")
        emitTransfer(id, moved, total, "running", null)
      }
      val rest = to.removePrefix("gdrive://").split('/')
      drive.upload(rest[0], rest.getOrElse(1) { "root" }, Uri.decode(rest.getOrElse(2) { staged.name }), staged, null)
      if (op == "move") {
        // Depot never deletes on Drive; a cross-account move copies then stops.
      }
    } finally {
      staged.delete()
    }
  }

  /* ── android bits ─────────────────────────────────────── */

  private fun hasAllFilesAccess(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }

  private fun startActivity(intent: Intent) {
    ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun uriFor(file: File): Uri =
    FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)

  private fun mimeOf(file: File): String =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"

  private fun listOpenWith(path: String): JSONArray {
    val file = File(path)
    val intent =
      Intent(Intent.ACTION_VIEW)
        .setDataAndType(uriFor(file), mimeOf(file))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val pm = ctx.packageManager
    val matches: List<ResolveInfo> =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
      } else {
        @Suppress("DEPRECATION") pm.queryIntentActivities(intent, 0)
      }
    val preferred = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)

    val out = JSONArray()
    for (info in matches) {
      val activity = info.activityInfo ?: continue
      out.put(
        JSONObject()
          .put("name", info.loadLabel(pm).toString())
          .put("path", "${activity.packageName}/${activity.name}")
          .put("isDefault", preferred?.activityInfo?.packageName == activity.packageName),
      )
    }
    return out
  }

  /** Renders a window of PDF pages to cached PNGs — Android has the renderer built in. */
  private fun renderPdf(path: String, from: Int, count: Int): JSONObject {
    val dir = File(ctx.cacheDir, "pdf/${File(path).nameWithoutExtension.hashCode()}")
    dir.mkdirs()
    ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
      PdfRenderer(fd).use { renderer ->
        val total = renderer.pageCount
        val pages = JSONArray()
        for (index in from until minOf(total, from + count)) {
          val target = File(dir, "page-$index.png")
          var width: Int
          var height: Int
          renderer.openPage(index).use { page ->
            // ~1240px wide reads cleanly on a phone without blowing up memory.
            val scale = (1240.0 / page.width).coerceAtMost(3.0)
            width = (page.width * scale).toInt()
            height = (page.height * scale).toInt()
            if (!target.isFile) {
              val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
              bitmap.eraseColor(Color.WHITE)
              page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 90, it) }
              bitmap.recycle()
            }
          }
          pages.put(
            JSONObject()
              .put("index", index)
              .put("uri", "file://${target.absolutePath}")
              .put("width", width)
              .put("height", height),
          )
        }
        return JSONObject().put("pages", pages).put("total", total)
      }
    }
  }

  /** Sidecar subtitle files sitting beside the movie, same as the desktop scan. */
  private fun listSubtitles(path: String): JSONArray {
    val movie = File(path)
    val stem = movie.nameWithoutExtension.lowercase()
    val out = JSONArray()
    movie.parentFile
      ?.listFiles()
      ?.filter {
        it.isFile &&
          it.extension.lowercase() in setOf("srt", "vtt", "ass", "ssa", "sub") &&
          it.nameWithoutExtension.lowercase().startsWith(stem)
      }
      ?.sortedBy { it.name }
      ?.forEach {
        out.put(
          JSONObject()
            .put("id", it.absolutePath)
            .put("label", it.nameWithoutExtension.removePrefix(movie.nameWithoutExtension).trim('.', '-', '_').ifEmpty { it.name })
            .put("language", JSONObject.NULL)
            .put("kind", "sidecar"),
        )
      }
    return out
  }

  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Int) = Unit
}

/** `optString` returns "" for a JSON null, which is not the same as absent. */
private fun JSONObject.optStringOrNull(key: String): String? {
  if (!has(key) || isNull(key)) return null
  return optString(key).ifEmpty { null }
}
