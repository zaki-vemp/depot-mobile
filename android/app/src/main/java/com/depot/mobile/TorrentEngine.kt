package com.depot.mobile

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * A small BitTorrent client: bencode, HTTP and UDP trackers, the peer wire
 * protocol, and BEP-9 metadata so plain magnet links work. It downloads
 * sequentially and verifies every piece against the info dict before it counts.
 *
 * Depot ships no search or indexer — the user supplies the link, exactly as on
 * the desktop.
 */
class TorrentEngine(private val settings: SettingsStore) {

  companion object {
    private const val BLOCK = 16 * 1024
    private const val PIPELINE = 12
    private const val PEER_LIMIT = 24
    private val PROTOCOL = "BitTorrent protocol".toByteArray()
  }

  private val nextId = AtomicInteger(1)
  private val torrents = ConcurrentHashMap<Int, Torrent>()
  private val pool = Executors.newCachedThreadPool { r -> Thread(r, "depot-torrent").apply { isDaemon = true } }
  /** Azureus-style id: client tag, then random. */
  private val peerId =
    ByteArray(20).also { id ->
      val tail = ByteArray(12)
      SecureRandom().nextBytes(tail)
      "-DP0100-".toByteArray().copyInto(id)
      tail.copyInto(id, 8)
    }

  fun add(link: String): String {
    val torrent =
      when {
        link.startsWith("magnet:") -> fromMagnet(link)
        link.startsWith("http://") || link.startsWith("https://") -> fromMetainfo(downloadBytes(link))
        else -> fromMetainfo(File(link).readBytes())
      }
    torrents[torrent.id] = torrent
    pool.execute { torrent.run() }
    return torrent.name
  }

  fun list(): JSONArray {
    val out = JSONArray()
    for (t in torrents.values.sortedBy { it.id }) out.put(t.snapshot())
    return out
  }

  fun pause(id: Int) {
    torrents[id]?.paused = true
  }

  fun resume(id: Int) {
    torrents[id]?.let {
      it.paused = false
      if (!it.alive) pool.execute { it.run() }
    }
  }

  fun remove(id: Int) {
    torrents.remove(id)?.stop()
  }

  fun shutdown() {
    torrents.values.forEach { it.stop() }
    torrents.clear()
    pool.shutdownNow()
  }

  /* ── construction ─────────────────────────────────────── */

  private fun fromMagnet(link: String): Torrent {
    val uri = Uri.parse(link)
    val xt = uri.getQueryParameters("xt").firstOrNull { it.startsWith("urn:btih:") }
      ?: throw IllegalArgumentException("That magnet link has no info hash")
    val raw = xt.removePrefix("urn:btih:")
    val hash =
      when (raw.length) {
        40 -> raw.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        32 -> base32(raw)
        else -> throw IllegalArgumentException("Unsupported info hash in the magnet link")
      }
    val trackers = uri.getQueryParameters("tr").toMutableList()
    val name = uri.getQueryParameter("dn") ?: hex(hash)
    return Torrent(nextId.getAndIncrement(), hash, name, trackers, null)
  }

  private fun fromMetainfo(bytes: ByteArray): Torrent {
    val root = Bencode.dict(Bencode.decode(bytes)) ?: throw IllegalArgumentException("Not a torrent file")
    val infoBytes =
      Bencode.sliceOf(bytes, "info") ?: throw IllegalArgumentException("Torrent has no info dict")
    val hash = sha1(infoBytes)
    val info = Bencode.dict(root["info"]) ?: throw IllegalArgumentException("Torrent has no info dict")
    val name = Bencode.text(info["name"]) ?: hex(hash)

    val trackers = ArrayList<String>()
    Bencode.text(root["announce"])?.let(trackers::add)
    (root["announce-list"] as? List<*>)?.forEach { tier ->
      (tier as? List<*>)?.forEach { url -> Bencode.text(url)?.let(trackers::add) }
    }
    return Torrent(nextId.getAndIncrement(), hash, name, trackers, infoBytes)
  }

  private fun downloadBytes(url: String): ByteArray {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 30_000
      instanceFollowRedirects = true
    }
    try {
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Could not fetch that torrent (HTTP ${connection.responseCode})")
      }
      return connection.inputStream.readBytes()
    } finally {
      connection.disconnect()
    }
  }

  /* ── one download ─────────────────────────────────────── */

  inner class Torrent(
    val id: Int,
    val infoHash: ByteArray,
    @Volatile var name: String,
    val trackers: MutableList<String>,
    infoBytes: ByteArray?,
  ) {
    @Volatile var paused = false
    @Volatile var alive = false
    @Volatile var state = "queued"
    @Volatile var error: String? = null

    val downloaded = AtomicLong(0)
    @Volatile var totalBytes = 0L
    @Volatile var speed = 0L

    private var info: Metainfo? = null
    private var metadata: ByteArray? = infoBytes
    private var have: BooleanArray = BooleanArray(0)
    private val inFlight = ConcurrentHashMap<Int, Long>()
    private val peers = ConcurrentHashMap.newKeySet<String>()
    private var storage: Storage? = null
    @Volatile private var stopped = false

    val outputFolder: File = settings.downloadDir()

    fun stop() {
      stopped = true
    }

    fun snapshot(): JSONObject {
      val total = totalBytes
      val done = downloaded.get().coerceAtMost(if (total > 0) total else Long.MAX_VALUE)
      return JSONObject()
        .put("id", id)
        .put("name", name)
        .put("progress", if (total > 0) done.toDouble() / total else 0.0)
        .put("downloaded", done)
        .put("total", total)
        .put("downloadSpeed", speed)
        .put("state", if (paused) "paused" else state)
        .put("error", error ?: JSONObject.NULL)
        .put("outputFolder", (info?.let { File(outputFolder, it.name) } ?: outputFolder).absolutePath)
    }

    fun run() {
      alive = true
      try {
        state = "announcing"
        var lastSample = System.currentTimeMillis()
        var lastBytes = 0L

        while (!stopped) {
          if (paused) {
            state = "paused"
            Thread.sleep(500)
            continue
          }

          val found = announceAll()
          if (found.isEmpty()) {
            state = "searching for peers"
            Thread.sleep(4000)
            continue
          }

          state = if (metadata == null) "fetching metadata" else "downloading"
          for (peer in found.take(PEER_LIMIT)) {
            val key = "${peer.address}:${peer.port}"
            if (!peers.add(key)) continue
            pool.execute {
              try {
                talk(peer)
              } catch (_: Exception) {
                /* peers drop constantly; the swarm covers it */
              } finally {
                peers.remove(key)
              }
            }
          }

          // Speed sample and completion check.
          Thread.sleep(1000)
          val now = System.currentTimeMillis()
          val bytes = downloaded.get()
          speed = ((bytes - lastBytes) * 1000 / maxOf(1, now - lastSample))
          lastBytes = bytes
          lastSample = now

          val meta = info
          if (meta != null && have.isNotEmpty() && have.all { it }) {
            state = "complete"
            speed = 0
            storage?.close()
            return
          }
        }
      } catch (e: Throwable) {
        error = e.message ?: e.toString()
        state = "error"
      } finally {
        alive = false
      }
    }

    /* ── trackers ───────────────────────────────────────── */

    private fun announceAll(): List<Peer> {
      val out = LinkedHashSet<Peer>()
      for (tracker in trackers.toList()) {
        try {
          val found =
            when {
              tracker.startsWith("http") -> announceHttp(tracker)
              tracker.startsWith("udp") -> announceUdp(tracker)
              else -> emptyList()
            }
          out.addAll(found)
        } catch (_: Exception) {
          /* one dead tracker must not stop the others */
        }
        if (out.size >= PEER_LIMIT * 2) break
      }
      return out.toList()
    }

    private fun announceHttp(tracker: String): List<Peer> {
      val left = if (totalBytes > 0) totalBytes - downloaded.get() else 1L
      val url =
        StringBuilder(tracker)
          .append(if (tracker.contains('?')) '&' else '?')
          .append("info_hash=").append(urlEncodeBytes(infoHash))
          .append("&peer_id=").append(urlEncodeBytes(peerId))
          .append("&port=6881&uploaded=0")
          .append("&downloaded=").append(downloaded.get())
          .append("&left=").append(left)
          .append("&compact=1&numwant=60&event=started")
          .toString()

      val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 15_000
      }
      try {
        if (connection.responseCode !in 200..299) return emptyList()
        val body = Bencode.dict(Bencode.decode(connection.inputStream.readBytes())) ?: return emptyList()
        return parseCompactPeers(body["peers"])
      } finally {
        connection.disconnect()
      }
    }

    /** BEP 15 — connect, then announce, over UDP. */
    private fun announceUdp(tracker: String): List<Peer> {
      val uri = Uri.parse(tracker)
      val host = uri.host ?: return emptyList()
      val port = if (uri.port > 0) uri.port else 80

      DatagramSocket().use { socket ->
        socket.soTimeout = 8000
        val address = InetAddress.getByName(host)
        val transactionId = SecureRandom().nextInt()

        val connect = ByteBuffer.allocate(16)
        connect.putLong(0x41727101980L)
        connect.putInt(0)
        connect.putInt(transactionId)
        socket.send(DatagramPacket(connect.array(), 16, address, port))

        val reply = ByteArray(16)
        socket.receive(DatagramPacket(reply, reply.size))
        val replyBuffer = ByteBuffer.wrap(reply)
        if (replyBuffer.int != 0 || replyBuffer.int != transactionId) return emptyList()
        val connectionId = replyBuffer.long

        val left = if (totalBytes > 0) totalBytes - downloaded.get() else 1L
        val announce = ByteBuffer.allocate(98)
        announce.putLong(connectionId)
        announce.putInt(1)
        announce.putInt(transactionId)
        announce.put(infoHash)
        announce.put(peerId)
        announce.putLong(downloaded.get())
        announce.putLong(left)
        announce.putLong(0)
        announce.putInt(2) // started
        announce.putInt(0)
        announce.putInt(0)
        announce.putInt(60)
        announce.putShort(6881)
        socket.send(DatagramPacket(announce.array(), 98, address, port))

        val response = ByteArray(20 + 6 * 60)
        val packet = DatagramPacket(response, response.size)
        socket.receive(packet)
        val buffer = ByteBuffer.wrap(response, 0, packet.length)
        if (buffer.int != 1) return emptyList()
        buffer.int // transaction
        buffer.int // interval
        buffer.int // leechers
        buffer.int // seeders

        val out = ArrayList<Peer>()
        while (buffer.remaining() >= 6) {
          val ip = ByteArray(4)
          buffer.get(ip)
          val peerPort = buffer.short.toInt() and 0xFFFF
          out.add(Peer(InetAddress.getByAddress(ip).hostAddress ?: continue, peerPort))
        }
        return out
      }
    }

    private fun parseCompactPeers(value: Any?): List<Peer> {
      val bytes = value as? ByteArray ?: return emptyList()
      val out = ArrayList<Peer>()
      var i = 0
      while (i + 6 <= bytes.size) {
        val host = "${bytes[i].toInt() and 0xFF}.${bytes[i + 1].toInt() and 0xFF}." +
          "${bytes[i + 2].toInt() and 0xFF}.${bytes[i + 3].toInt() and 0xFF}"
        val port = ((bytes[i + 4].toInt() and 0xFF) shl 8) or (bytes[i + 5].toInt() and 0xFF)
        out.add(Peer(host, port))
        i += 6
      }
      return out
    }

    /* ── peer wire ──────────────────────────────────────── */

    private fun talk(peer: Peer) {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(peer.address, peer.port), 6000)
        socket.soTimeout = 20_000
        val out = DataOutputStream(socket.getOutputStream().buffered())
        val input = DataInputStream(socket.getInputStream().buffered())

        // handshake: pstrlen, pstr, reserved (ext bit), info hash, peer id
        out.writeByte(PROTOCOL.size)
        out.write(PROTOCOL)
        val reserved = ByteArray(8)
        reserved[5] = 0x10 // BEP 10 extension protocol
        out.write(reserved)
        out.write(infoHash)
        out.write(peerId)
        out.flush()

        val length = input.readUnsignedByte()
        input.skipBytes(length)
        val theirReserved = ByteArray(8)
        input.readFully(theirReserved)
        val theirHash = ByteArray(20)
        input.readFully(theirHash)
        if (!theirHash.contentEquals(infoHash)) return
        input.skipBytes(20)

        val supportsExtensions = (theirReserved[5].toInt() and 0x10) != 0
        var metadataId = 0
        var metadataSize = 0
        var metadataBuffer: ByteArray? = null
        val metadataHave = HashSet<Int>()

        if (supportsExtensions) {
          val handshake =
            Bencode.encode(mapOf("m" to mapOf("ut_metadata" to 1L), "v" to "Depot 0.1"))
          sendMessage(out, 20, byteArrayOf(0) + handshake)
        }

        var choked = true
        var theirPieces = BooleanArray(0)
        var interestedSent = false
        val pending = ArrayList<Request>()

        while (!stopped && !paused) {
          val messageLength = try {
            input.readInt()
          } catch (_: Exception) {
            return
          }
          if (messageLength == 0) continue // keep-alive
          val messageId = input.readUnsignedByte()
          val payload = ByteArray(messageLength - 1)
          input.readFully(payload)

          when (messageId) {
            0 -> choked = true
            1 -> {
              choked = false
              fill(out, theirPieces, pending)
            }
            4 -> { // have
              val index = ByteBuffer.wrap(payload).int
              if (theirPieces.isEmpty() && have.isNotEmpty()) theirPieces = BooleanArray(have.size)
              if (index < theirPieces.size) theirPieces[index] = true
              if (!interestedSent) {
                sendMessage(out, 2, ByteArray(0))
                interestedSent = true
              }
            }
            5 -> { // bitfield
              if (have.isNotEmpty()) {
                theirPieces = BooleanArray(have.size)
                for (i in theirPieces.indices) {
                  val byte = payload.getOrNull(i / 8)?.toInt() ?: 0
                  theirPieces[i] = (byte shr (7 - i % 8)) and 1 == 1
                }
              }
              if (!interestedSent) {
                sendMessage(out, 2, ByteArray(0))
                interestedSent = true
              }
            }
            7 -> { // piece
              val buffer = ByteBuffer.wrap(payload)
              val index = buffer.int
              val begin = buffer.int
              val block = ByteArray(buffer.remaining())
              buffer.get(block)
              onBlock(index, begin, block)
              pending.removeAll { it.index == index && it.begin == begin }
              if (!choked) fill(out, theirPieces, pending)
            }
            20 -> { // extension
              val extId = payload[0].toInt() and 0xFF
              val body = payload.copyOfRange(1, payload.size)
              if (extId == 0) {
                val handshake = Bencode.dict(Bencode.decode(body))
                val m = Bencode.dict(handshake?.get("m"))
                metadataId = (Bencode.number(m?.get("ut_metadata")) ?: 0L).toInt()
                metadataSize = (Bencode.number(handshake?.get("metadata_size")) ?: 0L).toInt()
                if (metadata == null && metadataId > 0 && metadataSize > 0) {
                  metadataBuffer = ByteArray(metadataSize)
                  val pieces = (metadataSize + 16383) / 16384
                  for (piece in 0 until pieces) {
                    sendMessage(
                      out,
                      20,
                      byteArrayOf(metadataId.toByte()) +
                        Bencode.encode(mapOf("msg_type" to 0L, "piece" to piece.toLong())),
                    )
                  }
                }
              } else if (metadataBuffer != null) {
                // <bencoded header><raw bytes>
                val cursor = Bencode.Cursor(body)
                val header = Bencode.dict(Bencode.decode(cursor))
                if (Bencode.number(header?.get("msg_type")) == 1L) {
                  val piece = (Bencode.number(header?.get("piece")) ?: 0L).toInt()
                  val data = body.copyOfRange(cursor.at, body.size)
                  data.copyInto(metadataBuffer!!, piece * 16384)
                  metadataHave.add(piece)
                  if (metadataHave.size == (metadataSize + 16383) / 16384) {
                    adoptMetadata(metadataBuffer!!)
                    if (have.isNotEmpty()) theirPieces = BooleanArray(have.size)
                    sendMessage(out, 2, ByteArray(0))
                    interestedSent = true
                  }
                }
              }
            }
          }
        }
      }
    }

    private fun sendMessage(out: DataOutputStream, id: Int, payload: ByteArray) {
      out.writeInt(payload.size + 1)
      out.writeByte(id)
      out.write(payload)
      out.flush()
    }

    /** Keeps the pipeline topped up with blocks this peer can actually serve. */
    private fun fill(out: DataOutputStream, theirPieces: BooleanArray, pending: MutableList<Request>) {
      val meta = info ?: return
      while (pending.size < PIPELINE) {
        val request = nextRequest(meta, theirPieces) ?: return
        pending.add(request)
        val payload = ByteBuffer.allocate(12)
        payload.putInt(request.index)
        payload.putInt(request.begin)
        payload.putInt(request.length)
        sendMessage(out, 6, payload.array())
      }
    }

    private fun nextRequest(meta: Metainfo, theirPieces: BooleanArray): Request? {
      val now = System.currentTimeMillis()
      for (index in have.indices) {
        if (have[index]) continue
        if (theirPieces.isNotEmpty() && !theirPieces.getOrElse(index) { false }) continue
        val pieceLength = meta.pieceLengthAt(index)
        var begin = 0
        while (begin < pieceLength) {
          val key = index * 100_000 + begin / BLOCK
          val claimed = inFlight[key]
          if (claimed == null || now - claimed > 25_000) {
            inFlight[key] = now
            return Request(index, begin, minOf(BLOCK, pieceLength - begin))
          }
          begin += BLOCK
        }
      }
      return null
    }

    private fun onBlock(index: Int, begin: Int, block: ByteArray) {
      val meta = info ?: return
      val store = storage ?: return
      inFlight.remove(index * 100_000 + begin / BLOCK)
      store.write(meta.pieceLength * index.toLong() + begin, block)
      downloaded.addAndGet(block.size.toLong())

      // A piece only counts once its SHA-1 matches the info dict.
      val pieceLength = meta.pieceLengthAt(index)
      if (begin + block.size >= pieceLength) {
        val bytes = store.read(meta.pieceLength * index.toLong(), pieceLength)
        if (sha1(bytes).contentEquals(meta.pieceHash(index))) {
          have[index] = true
        } else {
          downloaded.addAndGet(-pieceLength.toLong())
        }
      }
    }

    /** Turns a fetched info dict into files on disk and a piece map. */
    @Synchronized
    private fun adoptMetadata(bytes: ByteArray) {
      if (info != null) return
      if (!sha1(bytes).contentEquals(infoHash)) {
        throw IllegalStateException("Metadata did not match the magnet's info hash")
      }
      metadata = bytes
      val meta = Metainfo.parse(bytes)
      info = meta
      name = meta.name
      totalBytes = meta.totalLength
      have = BooleanArray(meta.pieceCount)
      storage = Storage(File(outputFolder, meta.name), meta)
      state = "downloading"
    }

    init {
      if (infoBytes != null) adoptMetadata(infoBytes)
    }
  }

  /* ── metainfo + storage ───────────────────────────────── */

  class Metainfo(
    val name: String,
    val pieceLength: Int,
    val pieces: ByteArray,
    val files: List<Pair<String, Long>>,
    val singleFile: Boolean,
  ) {
    val totalLength = files.sumOf { it.second }
    val pieceCount = ((totalLength + pieceLength - 1) / pieceLength).toInt()

    fun pieceHash(index: Int): ByteArray = pieces.copyOfRange(index * 20, index * 20 + 20)

    fun pieceLengthAt(index: Int): Int {
      val start = pieceLength.toLong() * index
      return minOf(pieceLength.toLong(), totalLength - start).toInt()
    }

    companion object {
      fun parse(infoBytes: ByteArray): Metainfo {
        val info = Bencode.dict(Bencode.decode(infoBytes)) ?: throw IllegalArgumentException("Bad metadata")
        val name = Bencode.text(info["name"]) ?: "download"
        val pieceLength = (Bencode.number(info["piece length"]) ?: 0L).toInt()
        val pieces = info["pieces"] as? ByteArray ?: ByteArray(0)
        if (pieceLength <= 0 || pieces.isEmpty()) throw IllegalArgumentException("Bad metadata")

        val fileList = info["files"] as? List<*>
        if (fileList == null) {
          val length = Bencode.number(info["length"]) ?: 0L
          return Metainfo(name, pieceLength, pieces, listOf(name to length), true)
        }
        val files =
          fileList.mapNotNull { entry ->
            val file = Bencode.dict(entry) ?: return@mapNotNull null
            val parts =
              (file["path"] as? List<*>)?.mapNotNull { Bencode.text(it) } ?: return@mapNotNull null
            parts.joinToString("/") to (Bencode.number(file["length"]) ?: 0L)
          }
        return Metainfo(name, pieceLength, pieces, files, false)
      }
    }
  }

  /** Maps torrent-wide offsets onto the real files. */
  class Storage(root: File, private val meta: Metainfo) {
    private val handles = ArrayList<Pair<RandomAccessFile, Long>>()

    init {
      val base = if (meta.singleFile) root.parentFile ?: root else root
      base?.mkdirs()
      for ((relative, length) in meta.files) {
        val target = if (meta.singleFile) File(base, meta.name) else File(base, relative)
        target.parentFile?.mkdirs()
        val handle = RandomAccessFile(target, "rw")
        handle.setLength(length)
        handles.add(handle to length)
      }
    }

    @Synchronized
    fun write(offset: Long, data: ByteArray) {
      var position = offset
      var written = 0
      var fileStart = 0L
      for ((handle, length) in handles) {
        if (position < fileStart + length) {
          val within = position - fileStart
          val chunk = minOf((length - within).toInt(), data.size - written)
          handle.seek(within)
          handle.write(data, written, chunk)
          written += chunk
          position += chunk
          if (written >= data.size) return
        }
        fileStart += length
      }
    }

    @Synchronized
    fun read(offset: Long, length: Int): ByteArray {
      val out = ByteArray(length)
      var position = offset
      var read = 0
      var fileStart = 0L
      for ((handle, fileLength) in handles) {
        if (position < fileStart + fileLength) {
          val within = position - fileStart
          val chunk = minOf((fileLength - within).toInt(), length - read)
          handle.seek(within)
          handle.readFully(out, read, chunk)
          read += chunk
          position += chunk
          if (read >= length) return out
        }
        fileStart += fileLength
      }
      return out
    }

    @Synchronized
    fun close() = handles.forEach { runCatching { it.first.close() } }
  }

  data class Peer(val address: String, val port: Int)

  private data class Request(val index: Int, val begin: Int, val length: Int)

  /* ── small helpers ────────────────────────────────────── */

  private fun sha1(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-1").digest(bytes)

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  private fun urlEncodeBytes(bytes: ByteArray): String =
    bytes.joinToString("") { byte ->
      val c = byte.toInt().toChar()
      if (c.isLetterOrDigit() || c in "-_.~") c.toString()
      else "%" + "%02X".format(byte.toInt() and 0xFF)
    }

  private fun base32(value: String): ByteArray {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    var buffer = 0
    var bits = 0
    val out = ByteArray(20)
    var index = 0
    for (c in value.uppercase()) {
      val position = alphabet.indexOf(c)
      if (position < 0) continue
      buffer = (buffer shl 5) or position
      bits += 5
      if (bits >= 8) {
        bits -= 8
        if (index < out.size) out[index++] = ((buffer shr bits) and 0xFF).toByte()
      }
    }
    return out
  }
}
