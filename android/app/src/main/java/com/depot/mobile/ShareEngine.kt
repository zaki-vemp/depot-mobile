package com.depot.mobile

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Sending files and folders straight to another Depot on the same network.
 *
 * Two parts: a UDP beacon so devices find each other without anyone typing an
 * address, and a plain TCP stream for the bytes. Both ends are this app, so the
 * wire format is a length-prefixed JSON header followed by the file contents in
 * manifest order — no HTTP, no dependency.
 *
 * ## What this is not
 *
 * **Traffic is not encrypted.** Anyone able to watch packets on the same
 * network can read the file contents and the manifest. That is a disclosed
 * limitation rather than an oversight: doing it properly means TLS with a
 * self-signed certificate pinned to a fingerprint carried in the beacon, and
 * crypto that has never run on a real handset risks failing open — worse than a
 * limitation stated plainly. The UI says so before anything is sent.
 *
 * What it does guarantee: nothing is written until the receiving person accepts
 * a named offer, and every path in that offer is forced to stay inside the
 * destination folder (see [safeRelative]).
 */
class ShareEngine(
  private val ctx: Context,
  private val settings: SettingsStore,
  /** Pushes an event to JS as (name, JSON payload). */
  private val emit: (String, JSONObject) -> Unit,
) {

  companion object {
    /** Beacons go here; the port is fixed so two installs can find each other. */
    private const val DISCOVERY_PORT = 54330
    private const val MULTICAST_GROUP = "239.17.7.1"
    private const val BEACON_EVERY_MS = 3000L

    /** A peer unheard from for this long is dropped from the list. */
    private const val PEER_TTL_MS = 12_000L

    /** How long a sender waits for a person to accept or decline. */
    private const val ACCEPT_TIMEOUT_MS = 90_000L
    private const val CHUNK = 128 * 1024
    private const val MAX_FRAME = 4 * 1024 * 1024
    private const val PROTOCOL_VERSION = 1
  }

  class Peer(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    @Volatile var seen: Long,
  )

  private val deviceId = UUID.randomUUID().toString()
  private val deviceName =
    "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifEmpty { "Android device" }

  private val peers = ConcurrentHashMap<String, Peer>()
  private val offers = ConcurrentHashMap<String, Offer>()
  private val pool =
    Executors.newCachedThreadPool { r -> Thread(r, "depot-share").apply { isDaemon = true } }
  private val nextTransfer = AtomicLong(1)

  private var server: ServerSocket? = null
  private var beacon: MulticastSocket? = null
  private var lock: WifiManager.MulticastLock? = null

  @Volatile private var running = false

  /** One incoming offer, parked until the person answers it. */
  private class Offer(val gate: CountDownLatch) {
    @Volatile var accepted = false
  }

  /* -- lifecycle ------------------------------------------ */

  @Synchronized
  fun start(): JSONObject {
    if (running) return status()
    running = true

    val socket = ServerSocket(0)
    server = socket
    pool.execute { acceptLoop(socket) }

    // The Wi-Fi chip filters multicast out unless this is held.
    lock =
      (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
        ?.createMulticastLock("depot-share")
        ?.apply {
          setReferenceCounted(false)
          runCatching { acquire() }
        }

    // Built unbound: `MulticastSocket(port)` binds in its constructor, so
    // setting reuseAddress after that would be too late to take effect, and
    // two apps sharing the group would fail to bind.
    val discovery = MulticastSocket(null)
    discovery.reuseAddress = true
    discovery.bind(InetSocketAddress(DISCOVERY_PORT))
    runCatching { discovery.joinGroup(InetAddress.getByName(MULTICAST_GROUP)) }
    beacon = discovery
    pool.execute { beaconReceiveLoop(discovery) }
    pool.execute { beaconSendLoop(discovery) }
    pool.execute { reapLoop() }

    return status()
  }

  @Synchronized
  fun stop() {
    running = false
    runCatching { server?.close() }
    runCatching { beacon?.close() }
    runCatching { lock?.release() }
    server = null
    beacon = null
    lock = null
    peers.clear()
    // Anything still waiting on a person is answered as a decline.
    offers.values.forEach { it.gate.countDown() }
    offers.clear()
  }

  fun status(): JSONObject =
    JSONObject()
      .put("running", running)
      .put("id", deviceId)
      .put("name", deviceName)
      .put("port", server?.localPort ?: 0)

  fun peerList(): JSONArray {
    val out = JSONArray()
    for (peer in peers.values.sortedBy { it.name.lowercase() }) {
      out.put(
        JSONObject()
          .put("id", peer.id)
          .put("name", peer.name)
          .put("host", peer.host)
          .put("port", peer.port),
      )
    }
    return out
  }

  /* -- discovery ------------------------------------------ */

  private fun beaconSendLoop(socket: MulticastSocket) {
    while (running) {
      runCatching { announce(socket, null) }
      if (!sleep(BEACON_EVERY_MS)) return
    }
  }

  /**
   * Sends one beacon. Multicast reaches most networks; plenty of consumer
   * access points drop it, so the same packet also goes to every interface
   * broadcast address.
   */
  private fun announce(socket: MulticastSocket, to: InetAddress?) {
    val port = server?.localPort ?: return
    val body =
      JSONObject()
        .put("v", PROTOCOL_VERSION)
        .put("id", deviceId)
        .put("name", deviceName)
        .put("port", port)
        .toString()
        .toByteArray(Charsets.UTF_8)

    val targets =
      if (to != null) {
        listOf(to)
      } else {
        buildList {
          runCatching { add(InetAddress.getByName(MULTICAST_GROUP)) }
          addAll(broadcastAddresses())
        }
      }
    for (target in targets) {
      runCatching { socket.send(DatagramPacket(body, body.size, target, DISCOVERY_PORT)) }
    }
  }

  private fun broadcastAddresses(): List<InetAddress> =
    runCatching {
        NetworkInterface.getNetworkInterfaces()
          .toList()
          .filter { it.isUp && !it.isLoopback }
          .flatMap { it.interfaceAddresses }
          .mapNotNull { it.broadcast }
      }
      .getOrDefault(emptyList())

  private fun beaconReceiveLoop(socket: MulticastSocket) {
    val buffer = ByteArray(2048)
    while (running) {
      try {
        val packet = DatagramPacket(buffer, buffer.size)
        socket.receive(packet)
        val body = JSONObject(String(buffer, 0, packet.length, Charsets.UTF_8))
        val id = body.optString("id")
        val host = packet.address?.hostAddress
        if (id.isEmpty() || id == deviceId || host == null) continue

        val known = peers.containsKey(id)
        peers[id] =
          Peer(
            id = id,
            name = body.optString("name").ifEmpty { "Unknown device" },
            host = host,
            port = body.optInt("port"),
            seen = System.currentTimeMillis(),
          )
        if (!known) {
          // Answer straight back so the other side sees us without waiting for
          // its own beacon to come round.
          runCatching { announce(socket, packet.address) }
          emitPeers()
        }
      } catch (_: Exception) {
        if (!running) return
      }
    }
  }

  private fun reapLoop() {
    while (running) {
      if (!sleep(BEACON_EVERY_MS)) return
      val cutoff = System.currentTimeMillis() - PEER_TTL_MS
      val gone = peers.values.filter { it.seen < cutoff }
      if (gone.isNotEmpty()) {
        gone.forEach { peers.remove(it.id) }
        emitPeers()
      }
    }
  }

  private fun emitPeers() = emit("share:peers", JSONObject().put("peers", peerList()))

  /* -- receiving ------------------------------------------ */

  private fun acceptLoop(socket: ServerSocket) {
    while (running) {
      try {
        val client = socket.accept()
        pool.execute { receive(client) }
      } catch (_: Exception) {
        if (!running) return
      }
    }
  }

  private fun receive(socket: Socket) {
    val offerId = UUID.randomUUID().toString()
    try {
      socket.use {
        val input = DataInputStream(socket.getInputStream().buffered())
        val output = DataOutputStream(socket.getOutputStream())

        val header = JSONObject(String(readFrame(input), Charsets.UTF_8))
        if (header.optInt("v") != PROTOCOL_VERSION) {
          writeFrame(output, JSONObject().put("accept", false).put("why", "version").toString())
          return
        }

        val from = header.optString("name").ifEmpty { "Unknown device" }
        val manifest = header.optJSONArray("files") ?: JSONArray()
        val total = header.optLong("total")

        // Nothing touches disk until a person says yes.
        val offer = Offer(CountDownLatch(1))
        offers[offerId] = offer
        emit(
          "share:offer",
          JSONObject()
            .put("id", offerId)
            .put("from", from)
            .put("host", socket.inetAddress?.hostAddress ?: "")
            .put("files", manifest)
            .put("total", total),
        )

        val answered = offer.gate.await(ACCEPT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        offers.remove(offerId)
        if (!answered || !offer.accepted) {
          writeFrame(output, JSONObject().put("accept", false).toString())
          emit("share:done", JSONObject().put("id", offerId).put("state", "declined"))
          return
        }
        writeFrame(output, JSONObject().put("accept", true).toString())

        val root = File(settings.downloadDir(), "Depot from ${safeFolder(from)}")
        root.mkdirs()
        val fence = root.canonicalPath + File.separator

        var moved = 0L
        for (i in 0 until manifest.length()) {
          val entry = manifest.optJSONObject(i) ?: continue
          val size = entry.optLong("size")
          val relative =
            safeRelative(entry.optString("path"))
              ?: throw SecurityException("That device sent a file path Depot will not write")
          val target = File(root, relative)
          // Belt and braces: the resolved path must still sit under the root.
          if (!target.canonicalPath.startsWith(fence)) {
            throw SecurityException("That device sent a file path Depot will not write")
          }
          target.parentFile?.mkdirs()

          val before = moved
          target.outputStream().buffered().use { out ->
            copyExactly(input, out, size) { done ->
              emit(
                "share:progress",
                progress(offerId, relative, before + done, total, "in"),
              )
            }
          }
          moved += size
        }
        writeFrame(output, JSONObject().put("ok", true).toString())
        emit(
          "share:done",
          JSONObject().put("id", offerId).put("state", "done").put("folder", root.absolutePath),
        )
      }
    } catch (e: Exception) {
      offers.remove(offerId)
      emit(
        "share:done",
        JSONObject()
          .put("id", offerId)
          .put("state", "error")
          .put("error", e.message ?: e.toString()),
      )
    }
  }

  /** Answers an offer this device was shown. */
  fun respond(offerId: String, accept: Boolean) {
    val offer = offers[offerId] ?: return
    offer.accepted = accept
    offer.gate.countDown()
  }

  /* -- sending -------------------------------------------- */

  /**
   * Walks [paths], offers the result to [peerId] and streams it once accepted.
   * Returns immediately with a transfer id; progress arrives as events.
   */
  fun send(peerId: String, paths: List<String>): String {
    val peer =
      peers[peerId] ?: throw IllegalArgumentException("That device is no longer on the network")
    val files = ArrayList<Pair<File, String>>()
    for (path in paths) {
      val file = File(path)
      when {
        file.isDirectory -> collect(file, file.name, files)
        file.isFile -> files.add(file to file.name)
        else -> throw IllegalArgumentException("${file.name} is not there any more")
      }
    }
    if (files.isEmpty()) throw IllegalArgumentException("Nothing to send")

    val id = "share-${nextTransfer.getAndIncrement()}"
    pool.execute { stream(id, peer, files) }
    return id
  }

  private fun collect(dir: File, prefix: String, into: MutableList<Pair<File, String>>) {
    val children = dir.listFiles() ?: return
    for (child in children) {
      // Symlinks are skipped; following one would send whatever it points at,
      // which may be nowhere near the folder the user picked.
      if (child.canonicalFile != child.absoluteFile) continue
      if (child.isDirectory) collect(child, "$prefix/${child.name}", into)
      else if (child.isFile) into.add(child to "$prefix/${child.name}")
    }
  }

  private fun stream(id: String, peer: Peer, files: List<Pair<File, String>>) {
    val total = files.sumOf { it.first.length() }
    try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(peer.host, peer.port), 8000)
        val output = DataOutputStream(socket.getOutputStream())
        val input = DataInputStream(socket.getInputStream().buffered())

        val manifest = JSONArray()
        for ((file, relative) in files) {
          manifest.put(JSONObject().put("path", relative).put("size", file.length()))
        }
        writeFrame(
          output,
          JSONObject()
            .put("v", PROTOCOL_VERSION)
            .put("id", deviceId)
            .put("name", deviceName)
            .put("files", manifest)
            .put("total", total)
            .toString(),
        )
        emit("share:progress", progress(id, "waiting for ${peer.name}", 0, total, "out"))

        val reply = JSONObject(String(readFrame(input), Charsets.UTF_8))
        if (!reply.optBoolean("accept")) {
          emit("share:done", JSONObject().put("id", id).put("state", "declined"))
          return
        }

        var moved = 0L
        for ((file, relative) in files) {
          val before = moved
          file.inputStream().buffered().use { source ->
            copyExactly(source, output, file.length()) { done ->
              emit("share:progress", progress(id, relative, before + done, total, "out"))
            }
          }
          moved += file.length()
        }
        output.flush()
        readFrame(input) // the receiver's acknowledgement
        emit("share:done", JSONObject().put("id", id).put("state", "done"))
      }
    } catch (e: Exception) {
      emit(
        "share:done",
        JSONObject().put("id", id).put("state", "error").put("error", e.message ?: e.toString()),
      )
    }
  }

  private fun progress(id: String, name: String, moved: Long, total: Long, direction: String) =
    JSONObject()
      .put("id", id)
      .put("name", name)
      .put("moved", moved.toDouble())
      .put("total", total.toDouble())
      .put("direction", direction)

  /* -- framing -------------------------------------------- */

  private fun writeFrame(out: DataOutputStream, text: String) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    out.writeInt(bytes.size)
    out.write(bytes)
    out.flush()
  }

  private fun readFrame(input: DataInputStream): ByteArray {
    val size = input.readInt()
    // A hostile or confused peer must not be able to ask for a huge allocation.
    if (size !in 1..MAX_FRAME) throw IllegalStateException("Bad message from that device")
    val bytes = ByteArray(size)
    input.readFully(bytes)
    return bytes
  }

  /**
   * Moves exactly [size] bytes. Files run back to back down one connection, so
   * reading a single byte too many or too few desynchronises everything after
   * it — this never reads past the declared length.
   */
  private fun copyExactly(
    source: InputStream,
    sink: OutputStream,
    size: Long,
    onProgress: (Long) -> Unit,
  ) {
    val buffer = ByteArray(CHUNK)
    var done = 0L
    var lastReport = 0L
    while (done < size) {
      val want = minOf(CHUNK.toLong(), size - done).toInt()
      val read = source.read(buffer, 0, want)
      if (read < 0) throw IllegalStateException("The connection dropped mid-file")
      sink.write(buffer, 0, read)
      done += read
      // Roughly every megabyte; an event per chunk would flood the bridge.
      if (done - lastReport >= 1024 * 1024 || done == size) {
        lastReport = done
        onProgress(done)
      }
    }
  }

  /* -- keeping writes where they belong -------------------- */

  /**
   * Turns a path from another device into one that cannot escape the
   * destination folder. Anything absolute, anything containing `..`, and
   * anything carrying a drive or scheme separator is refused outright rather
   * than rewritten — a path that odd is not worth guessing at.
   */
  private fun safeRelative(raw: String): String? {
    val cleaned = raw.replace('\\', '/').trim()
    if (cleaned.isEmpty() || cleaned.startsWith("/")) return null
    val parts = cleaned.split('/').filter { it.isNotEmpty() && it != "." }
    if (parts.isEmpty()) return null
    if (parts.any { it == ".." || it.contains(':') }) return null
    return parts.joinToString("/")
  }

  private fun safeFolder(name: String): String =
    name.replace(Regex("[^A-Za-z0-9 _.-]"), "").trim().ifEmpty { "a device" }

  /** Returns false when the thread was interrupted, so loops can bail out. */
  private fun sleep(millis: Long): Boolean =
    try {
      Thread.sleep(millis)
      running
    } catch (_: InterruptedException) {
      false
    }
}
