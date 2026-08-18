package com.depot.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Google Drive over the same loopback OAuth flow the desktop app uses, so one
 * OAuth client covers both builds: Depot opens the system browser, Google
 * redirects to `http://127.0.0.1:17843/callback`, and a one-shot local socket
 * catches the code.
 *
 * Tokens live in the app's private storage. Drive paths are addressed as
 * `gdrive://<accountId>/<fileId>` so the rest of Depot can treat them as paths.
 */
class DriveClient(private val ctx: Context, private val settings: SettingsStore) {

  companion object {
    private const val PORT = 17843
    private const val REDIRECT = "http://127.0.0.1:$PORT/callback"
    private const val SCOPE = "https://www.googleapis.com/auth/drive openid email"
    private const val FOLDER_MIME = "application/vnd.google-apps.folder"
    private val EXPORTS =
      mapOf(
        "application/vnd.google-apps.document" to
          ("application/vnd.openxmlformats-officedocument.wordprocessingml.document" to "docx"),
        "application/vnd.google-apps.spreadsheet" to
          ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" to "xlsx"),
        "application/vnd.google-apps.presentation" to
          ("application/vnd.openxmlformats-officedocument.presentationml.presentation" to "pptx"),
        "application/vnd.google-apps.drawing" to ("image/png" to "png"),
      )
  }

  private val store = File(ctx.filesDir, "drive-accounts.json")
  private val cacheDir = File(ctx.cacheDir, "drive").apply { mkdirs() }

  /* ── accounts ─────────────────────────────────────────── */

  private fun accounts(): JSONObject =
    try {
      if (store.exists()) JSONObject(store.readText()) else JSONObject()
    } catch (_: Exception) {
      JSONObject()
    }

  private fun writeAccounts(all: JSONObject) = store.writeText(all.toString())

  fun list(): JSONArray {
    val all = accounts()
    val out = JSONArray()
    for (id in all.keys()) {
      out.put(JSONObject().put("id", id).put("email", all.getJSONObject(id).optString("email", id)))
    }
    return out
  }

  fun disconnect(accountId: String) {
    val all = accounts()
    all.remove(accountId)
    writeAccounts(all)
  }

  /* ── sign-in ──────────────────────────────────────────── */

  fun connect(): JSONObject {
    val clientId = settings.get("googleClientId").trim()
    val clientSecret = settings.get("googleClientSecret").trim()
    if (clientId.isEmpty()) {
      throw IllegalStateException("Add a Google client ID in Settings first.")
    }

    val verifier = randomString(64)
    val challenge =
      Base64.encodeToString(
          MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()),
          Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
        .trim()
    val state = randomString(24)

    val authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth" +
        "?client_id=${enc(clientId)}" +
        "&redirect_uri=${enc(REDIRECT)}" +
        "&response_type=code" +
        "&scope=${enc(SCOPE)}" +
        "&code_challenge=${enc(challenge)}" +
        "&code_challenge_method=S256" +
        "&access_type=offline" +
        "&prompt=consent" +
        "&state=${enc(state)}"

    // The socket has to be listening before the browser can redirect into it.
    val server = ServerSocket(PORT)
    server.soTimeout = TimeUnit.MINUTES.toMillis(3).toInt()

    try {
      ctx.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(authUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )

      val params = awaitRedirect(server, state)
      val code = params["code"] ?: throw IllegalStateException(params["error"] ?: "Sign-in cancelled")

      val body = StringBuilder()
      body.append("code=").append(enc(code))
      body.append("&client_id=").append(enc(clientId))
      if (clientSecret.isNotEmpty()) body.append("&client_secret=").append(enc(clientSecret))
      body.append("&redirect_uri=").append(enc(REDIRECT))
      body.append("&grant_type=authorization_code")
      body.append("&code_verifier=").append(enc(verifier))

      val token = postForm("https://oauth2.googleapis.com/token", body.toString())
      val access = token.optString("access_token")
      if (access.isEmpty()) throw IllegalStateException("Google did not return an access token")

      val email = userinfo(access)
      val all = accounts()
      // Reconnecting the same email refreshes it instead of adding a duplicate.
      val existing = all.keys().asSequence().firstOrNull {
        all.getJSONObject(it).optString("email") == email
      }
      val id = existing ?: randomString(12)
      val record =
        JSONObject()
          .put("email", email)
          .put("accessToken", access)
          .put(
            "refreshToken",
            token.optString("refreshToken", token.optString("refresh_token", existingRefresh(all, id))),
          )
          .put("expiresAt", System.currentTimeMillis() + token.optLong("expires_in", 3000) * 1000)
      all.put(id, record)
      writeAccounts(all)
      return JSONObject().put("id", id).put("email", email)
    } finally {
      runCatching { server.close() }
    }
  }

  private fun existingRefresh(all: JSONObject, id: String) =
    all.optJSONObject(id)?.optString("refreshToken", "") ?: ""

  /** Reads one HTTP request off the loopback socket and answers with a page. */
  private fun awaitRedirect(server: ServerSocket, state: String): Map<String, String> {
    while (true) {
      val socket = server.accept()
      socket.use {
        val reader = it.getInputStream().bufferedReader()
        val requestLine = reader.readLine() ?: return@use
        val target = requestLine.split(" ").getOrNull(1) ?: ""
        val query = target.substringAfter('?', "")
        val params =
          query
            .split('&')
            .filter { part -> part.contains('=') }
            .associate { part ->
              val (k, v) = part.split('=', limit = 2)
              k to Uri.decode(v)
            }

        respond(it.getOutputStream(), params.containsKey("code"))

        if (params.isEmpty()) return@use
        if (params["state"] != state && params["error"] == null) {
          throw IllegalStateException("OAuth state mismatch — sign-in was not completed safely")
        }
        return params
      }
    }
  }

  private fun respond(out: OutputStream, ok: Boolean) {
    val page =
      """
      <!doctype html><meta charset="utf-8"><title>Depot</title>
      <body style="font:16px -apple-system,Segoe UI,Roboto,sans-serif;padding:44px;background:#fdfdfc;color:#1b1c1e">
      <h2 style="margin:0 0 8px">${if (ok) "Depot is connected" else "Sign-in was cancelled"}</h2>
      <p style="color:#6b6b67;margin:0">You can close this tab and return to the app.</p>
      """.trimIndent()
    val bytes = page.toByteArray()
    out.write(
      ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n")
        .toByteArray(),
    )
    out.write(bytes)
    out.flush()
  }

  /* ── tokens ───────────────────────────────────────────── */

  private fun accessToken(accountId: String): String {
    val all = accounts()
    val record =
      all.optJSONObject(accountId) ?: throw IllegalStateException("That Google account is not connected")
    if (System.currentTimeMillis() < record.optLong("expiresAt") - 60_000) {
      return record.getString("accessToken")
    }
    val refresh = record.optString("refreshToken")
    if (refresh.isEmpty()) throw IllegalStateException("Sign in to this Google account again")

    val clientId = settings.get("googleClientId").trim()
    val clientSecret = settings.get("googleClientSecret").trim()
    val body = StringBuilder()
    body.append("client_id=").append(enc(clientId))
    if (clientSecret.isNotEmpty()) body.append("&client_secret=").append(enc(clientSecret))
    body.append("&refresh_token=").append(enc(refresh))
    body.append("&grant_type=refresh_token")

    val token = postForm("https://oauth2.googleapis.com/token", body.toString())
    val access = token.optString("access_token")
    if (access.isEmpty()) throw IllegalStateException("Could not refresh the Google session")
    record.put("accessToken", access)
    record.put("expiresAt", System.currentTimeMillis() + token.optLong("expires_in", 3000) * 1000)
    all.put(accountId, record)
    writeAccounts(all)
    return access
  }

  /* ── listing ──────────────────────────────────────────── */

  fun listFolder(accountId: String, folderId: String?): JSONArray {
    val parent = folderId ?: "root"
    val query = enc("'$parent' in parents and trashed = false")
    val fields = enc("files(id,name,mimeType,size,modifiedTime),nextPageToken")
    val out = JSONArray()
    var pageToken: String? = null

    do {
      val url =
        StringBuilder("https://www.googleapis.com/drive/v3/files?q=$query&fields=$fields")
          .append("&pageSize=200&orderBy=folder,name_natural")
          .append("&supportsAllDrives=true&includeItemsFromAllDrives=true")
      if (pageToken != null) url.append("&pageToken=").append(enc(pageToken))

      val page = get(url.toString(), accessToken(accountId))
      val files = page.optJSONArray("files") ?: JSONArray()
      for (i in 0 until files.length()) {
        val f = files.getJSONObject(i)
        val isDir = f.optString("mimeType") == FOLDER_MIME
        val name = f.optString("name")
        out.put(
          JSONObject()
            .put("name", name)
            .put("path", "gdrive://$accountId/${f.optString("id")}")
            .put("isDir", isDir)
            .put("size", f.optString("size", "0").toLongOrNull() ?: 0L)
            .put("modified", parseRfc3339(f.optString("modifiedTime")))
            .put("ext", if (isDir) "" else name.substringAfterLast('.', "").lowercase())
            .put("source", "gdrive")
            .put("mimeType", f.optString("mimeType"))
            .put("accountId", accountId),
        )
      }
      pageToken = page.optString("nextPageToken").ifEmpty { null }
    } while (pageToken != null)

    return out
  }

  fun makeFolder(accountId: String, folderId: String?, name: String): String {
    val payload =
      JSONObject()
        .put("name", name)
        .put("mimeType", FOLDER_MIME)
        .put("parents", JSONArray().put(folderId ?: "root"))
    val created =
      postJson(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        payload.toString(),
        accessToken(accountId),
      )
    return created.optString("id")
  }

  fun quota(accountId: String): JSONObject {
    val about =
      get(
        "https://www.googleapis.com/drive/v3/about?fields=" + enc("storageQuota"),
        accessToken(accountId),
      )
    val q = about.optJSONObject("storageQuota") ?: JSONObject()
    val total = q.optString("limit", "0").toLongOrNull() ?: 0L
    val used = q.optString("usage", "0").toLongOrNull() ?: 0L
    return JSONObject()
      .put("total", total)
      .put("free", (total - used).coerceAtLeast(0))
      .put("mount", "Google Drive")
  }

  /* ── file bytes ───────────────────────────────────────── */

  /** Caches a Drive file locally and returns its path — used by every viewer. */
  fun cache(path: String, name: String): String {
    val (accountId, fileId) = split(path)
    val meta =
      get(
        "https://www.googleapis.com/drive/v3/files/$fileId?fields=" + enc("name,mimeType,size"),
        accessToken(accountId),
      )
    val export = EXPORTS[meta.optString("mimeType")]
    val safe = (name.ifEmpty { meta.optString("name", fileId) }).replace('/', '_')
    val target =
      File(cacheDir, if (export != null) "$fileId-${safe.substringBeforeLast('.')}.${export.second}" else "$fileId-$safe")
    if (target.isFile && target.length() > 0) return target.absolutePath
    download(accountId, fileId, export?.first, target, null)
    return target.absolutePath
  }

  /**
   * Streams a Drive file to `dest`, reporting bytes as they land so the transfer
   * list moves. Google Docs formats are exported to their Office equivalent.
   */
  fun download(
    accountId: String,
    fileId: String,
    exportMime: String?,
    dest: File,
    onProgress: ((Long, Long) -> Unit)?,
  ) {
    val url =
      if (exportMime != null) {
        "https://www.googleapis.com/drive/v3/files/$fileId/export?mimeType=${enc(exportMime)}"
      } else {
        "https://www.googleapis.com/drive/v3/files/$fileId?alt=media&supportsAllDrives=true"
      }
    val connection = open(url, accessToken(accountId))
    connection.inputStream.use { input ->
      val total = connection.contentLengthLong.coerceAtLeast(0)
      dest.parentFile?.mkdirs()
      dest.outputStream().use { output ->
        val buffer = ByteArray(256 * 1024)
        var moved = 0L
        while (true) {
          val read = input.read(buffer)
          if (read <= 0) break
          output.write(buffer, 0, read)
          moved += read
          onProgress?.invoke(moved, total)
        }
      }
    }
  }

  /** Resumable upload of a local file into a Drive folder. */
  fun upload(
    accountId: String,
    parentId: String,
    name: String,
    source: File,
    onProgress: ((Long, Long) -> Unit)?,
  ) {
    val token = accessToken(accountId)
    val metadata =
      JSONObject().put("name", name).put("parents", JSONArray().put(parentId)).toString()

    val start =
      (URL("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true")
          .openConnection() as HttpURLConnection)
        .apply {
          requestMethod = "POST"
          doOutput = true
          setRequestProperty("Authorization", "Bearer $token")
          setRequestProperty("Content-Type", "application/json; charset=UTF-8")
          setRequestProperty("X-Upload-Content-Length", source.length().toString())
        }
    start.outputStream.use { it.write(metadata.toByteArray()) }
    if (start.responseCode !in 200..299) {
      throw IllegalStateException("Drive refused the upload: ${errorText(start)}")
    }
    val session =
      start.getHeaderField("Location") ?: throw IllegalStateException("Drive gave no upload session")
    start.disconnect()

    val put =
      (URL(session).openConnection() as HttpURLConnection).apply {
        requestMethod = "PUT"
        doOutput = true
        setFixedLengthStreamingMode(source.length())
        setRequestProperty("Content-Length", source.length().toString())
      }
    val total = source.length()
    put.outputStream.use { output ->
      source.inputStream().use { input ->
        val buffer = ByteArray(256 * 1024)
        var moved = 0L
        while (true) {
          val read = input.read(buffer)
          if (read <= 0) break
          output.write(buffer, 0, read)
          moved += read
          onProgress?.invoke(moved, total)
        }
      }
    }
    if (put.responseCode !in 200..299) {
      throw IllegalStateException("Upload failed: ${errorText(put)}")
    }
    put.disconnect()
  }

  fun size(accountId: String, fileId: String): Long {
    val meta =
      get(
        "https://www.googleapis.com/drive/v3/files/$fileId?fields=" + enc("size"),
        accessToken(accountId),
      )
    return meta.optString("size", "0").toLongOrNull() ?: 0L
  }

  fun exportMimeFor(accountId: String, fileId: String): String? {
    val meta =
      get(
        "https://www.googleapis.com/drive/v3/files/$fileId?fields=" + enc("mimeType"),
        accessToken(accountId),
      )
    return EXPORTS[meta.optString("mimeType")]?.first
  }

  /** `gdrive://account/fileId` → (account, fileId). */
  fun split(path: String): Pair<String, String> {
    val rest = path.removePrefix("gdrive://")
    val parts = rest.split('/')
    if (parts.size < 2) throw IllegalArgumentException("Not a Drive path: $path")
    return parts[0] to parts[1]
  }

  fun trash(path: String) {
    val (accountId, fileId) = split(path)
    patchJson(
      "https://www.googleapis.com/drive/v3/files/$fileId?supportsAllDrives=true",
      JSONObject().put("trashed", true).toString(),
      accessToken(accountId),
    )
  }

  fun rename(path: String, name: String) {
    val (accountId, fileId) = split(path)
    patchJson(
      "https://www.googleapis.com/drive/v3/files/$fileId?supportsAllDrives=true",
      JSONObject().put("name", name).toString(),
      accessToken(accountId),
    )
  }

  /* ── http ─────────────────────────────────────────────── */

  private fun open(url: String, token: String): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      setRequestProperty("Authorization", "Bearer $token")
      connectTimeout = 20_000
      readTimeout = 60_000
    }

  private fun get(url: String, token: String): JSONObject {
    val connection = open(url, token)
    try {
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Drive request failed: ${errorText(connection)}")
      }
      return JSONObject(connection.inputStream.bufferedReader().readText())
    } finally {
      connection.disconnect()
    }
  }

  private fun postJson(url: String, body: String, token: String): JSONObject {
    val connection =
      open(url, token).apply {
        requestMethod = "POST"
        doOutput = true
        setRequestProperty("Content-Type", "application/json; charset=UTF-8")
      }
    try {
      connection.outputStream.use { it.write(body.toByteArray()) }
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Drive request failed: ${errorText(connection)}")
      }
      return JSONObject(connection.inputStream.bufferedReader().readText())
    } finally {
      connection.disconnect()
    }
  }

  private fun patchJson(url: String, body: String, token: String): JSONObject {
    val connection =
      open(url, token).apply {
        requestMethod = "PATCH"
        doOutput = true
        setRequestProperty("Content-Type", "application/json; charset=UTF-8")
      }
    try {
      connection.outputStream.use { it.write(body.toByteArray()) }
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Drive request failed: ${errorText(connection)}")
      }
      val text = connection.inputStream.bufferedReader().readText()
      return if (text.isBlank()) JSONObject() else JSONObject(text)
    } finally {
      connection.disconnect()
    }
  }

  private fun postForm(url: String, body: String): JSONObject {
    val connection =
      (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        doOutput = true
        connectTimeout = 20_000
        readTimeout = 30_000
        setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
      }
    try {
      connection.outputStream.use { it.write(body.toByteArray()) }
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Google rejected the sign-in: ${errorText(connection)}")
      }
      return JSONObject(connection.inputStream.bufferedReader().readText())
    } finally {
      connection.disconnect()
    }
  }

  private fun userinfo(token: String): String {
    val info = get("https://www.googleapis.com/oauth2/v2/userinfo", token)
    return info.optString("email").ifEmpty { "Google account" }
  }

  private fun errorText(connection: HttpURLConnection): String =
    try {
      connection.errorStream?.bufferedReader()?.readText()?.take(300) ?: "HTTP ${connection.responseCode}"
    } catch (_: Exception) {
      "HTTP ${connection.responseCode}"
    }

  private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")

  private fun randomString(length: Int): String {
    val bytes = ByteArray(length)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
      .trim()
      .take(length)
  }

  /** RFC 3339 to unix seconds, without pulling in a date library. */
  private fun parseRfc3339(value: String): Long? {
    if (value.isEmpty()) return null
    return try {
      val format =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply {
          timeZone = java.util.TimeZone.getTimeZone("UTC")
        }
      format.parse(value.substringBefore('.').removeSuffix("Z"))?.time?.div(1000)
    } catch (_: Exception) {
      null
    }
  }
}
