package com.depot.mobile

import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * BEP 5 — the BitTorrent DHT, enough of it to find a swarm.
 *
 * Most public magnet links now carry few trackers or none at all and expect the
 * client to ask the DHT instead, so without this a trackerless link could never
 * find a peer. This is a Kademlia lookup over KRPC: `get_peers` is sent to the
 * nodes closest to the info hash, each reply either hands back peers or points
 * at closer nodes, and the search walks inward until it stops improving.
 *
 * It is deliberately a leaf node. Depot never accepts incoming connections, so
 * it does **not** send `announce_peer` — advertising a port nothing listens on
 * would hand every other client in the swarm a dead address. It answers `ping`
 * so the nodes it talks to can keep it in their tables, and ignores the rest.
 */
class Dht : Closeable {

  companion object {
    /**
     * The well-known bootstrap routers; they are entry points, not peers.
     * `dht.transmissionbt.com` and `dht.libtorrent.org` answer reliably; the two
     * BitTorrent Inc. routers frequently do not, which is why there are four.
     */
    private val ROUTERS =
      listOf(
        "router.bittorrent.com" to 6881,
        "dht.transmissionbt.com" to 6881,
        "router.utorrent.com" to 6881,
        "dht.libtorrent.org" to 25401,
      )
    private const val ID_BITS = 20
    /** Kademlia's α: how many nodes a single round of a lookup asks at once. */
    private const val ALPHA = 8
    /** A lookup that stops finding closer nodes gives up after this many rounds. */
    private const val MAX_ROUNDS = 6
    private const val QUERY_TIMEOUT_MS = 3000L
    /** Bounded so a long session cannot grow the table without limit. */
    private const val TABLE_LIMIT = 400
  }

  private class Waiting(val future: CompletableFuture<Map<String, Any?>>, val since: Long)

  data class Node(val id: ByteArray, val address: InetSocketAddress) {
    // Identity is the address; two entries for one host are the same node even
    // if it rotated its id between replies.
    override fun equals(other: Any?) = other is Node && other.address == address
    override fun hashCode() = address.hashCode()
  }

  private val random = SecureRandom()
  private val nodeId = ByteArray(ID_BITS).also { random.nextBytes(it) }
  private val socket = DatagramSocket()
  /**
   * In-flight queries by transaction id. `CompletableFuture.orTimeout` would be
   * the obvious way to expire these, but it is API 31 and this app ships to 24
   * without core-library desugaring, so entries carry their own deadline and
   * are swept instead.
   */
  private val pending = ConcurrentHashMap<String, Waiting>()
  private val table = ConcurrentHashMap<InetSocketAddress, Node>()
  private val nextTx = AtomicInteger(random.nextInt(0xffff))

  @Volatile private var running = true
  @Volatile private var booted = false

  private val reader =
    Thread({ receiveLoop() }, "depot-dht").apply {
      isDaemon = true
      start()
    }

  /* ── the lookup ───────────────────────────────────────── */

  /**
   * Walks the DHT toward [infoHash] and returns whatever peers turn up.
   * Returns empty rather than throwing: a lookup finding nothing is a normal
   * outcome for a cold or unpopular hash, and the caller retries on its own.
   */
  fun getPeers(infoHash: ByteArray): List<TorrentEngine.Peer> {
    if (!running) return emptyList()
    bootstrap()

    val byDistance = closest(infoHash)
    val peers = LinkedHashSet<TorrentEngine.Peer>()
    val asked = HashSet<InetSocketAddress>()
    var frontier = table.values.sortedWith(byDistance).take(ALPHA).toMutableList()
    if (frontier.isEmpty()) frontier = routerNodes().toMutableList()

    for (round in 0 until MAX_ROUNDS) {
      val batch = frontier.filter { asked.add(it.address) }.take(ALPHA)
      if (batch.isEmpty()) break

      val replies =
        batch
          .map { node -> node to query(node.address, "get_peers", mapOf("info_hash" to infoHash)) }
          .mapNotNull { (node, future) ->
            runCatching { future.get(QUERY_TIMEOUT_MS, TimeUnit.MILLISECONDS) }.getOrNull()?.let {
              node to it
            }
          }

      var foundCloser = false
      for ((_, reply) in replies) {
        val body = Bencode.dict(reply["r"]) ?: continue
        peers += compactPeers(body["values"])
        for (found in compactNodes(body["nodes"])) {
          remember(found)
          // Only nodes not already asked can move the search forward.
          if (found.address !in asked) {
            frontier.add(found)
            foundCloser = true
          }
        }
      }

      frontier =
        frontier
          .filter { it.address !in asked }
          .distinctBy { it.address }
          .sortedWith(byDistance)
          .take(ALPHA * 2)
          .toMutableList()

      // Peers in hand and nothing new to chase means the search is done.
      if (!foundCloser && peers.isNotEmpty()) break
    }
    return peers.toList()
  }

  /* ── bootstrap and the routing table ──────────────────── */

  /** One `find_node` at the routers, enough to seed the table. */
  private fun bootstrap() {
    if (booted && table.isNotEmpty()) return
    booted = true
    val futures =
      routerNodes().map { it to query(it.address, "find_node", mapOf("target" to nodeId)) }
    for ((_, future) in futures) {
      val reply = runCatching { future.get(QUERY_TIMEOUT_MS, TimeUnit.MILLISECONDS) }.getOrNull()
      val body = Bencode.dict(reply?.get("r")) ?: continue
      compactNodes(body["nodes"]).forEach(::remember)
    }
  }

  private fun routerNodes(): List<Node> =
    ROUTERS.mapNotNull { (host, port) ->
      runCatching { Node(ByteArray(ID_BITS), InetSocketAddress(InetAddress.getByName(host), port)) }
        .getOrNull()
    }

  private fun remember(node: Node) {
    if (node.address.address == null) return
    if (table.size >= TABLE_LIMIT) return
    table[node.address] = node
  }

  /** Kademlia distance is XOR on the ids, compared as one big unsigned number. */
  private fun closest(target: ByteArray) =
    Comparator<Node> { a, b ->
      for (i in 0 until ID_BITS) {
        val x = (a.id[i].toInt() xor target[i].toInt()) and 0xFF
        val y = (b.id[i].toInt() xor target[i].toInt()) and 0xFF
        if (x != y) return@Comparator x - y
      }
      0
    }

  /* ── KRPC ─────────────────────────────────────────────── */

  private fun query(
    address: InetSocketAddress,
    method: String,
    args: Map<String, Any?>,
  ): CompletableFuture<Map<String, Any?>> {
    sweep()
    val future = CompletableFuture<Map<String, Any?>>()
    val tx = nextTx.incrementAndGet() and 0xffff
    val tid = byteArrayOf((tx shr 8).toByte(), tx.toByte())
    val key = hex(tid)
    pending[key] = Waiting(future, System.currentTimeMillis())

    val message =
      mapOf(
        "t" to tid,
        "y" to "q",
        "q" to method,
        "a" to (mapOf<String, Any?>("id" to nodeId) + args),
      )
    val encoded = runCatching { Bencode.encode(message) }.getOrNull()
    if (encoded == null || !send(encoded, address)) {
      pending.remove(key)
      future.completeExceptionally(IllegalStateException("Could not send $method"))
      return future
    }
    return future
  }

  /** Drops queries no node ever answered, so `pending` cannot grow unbounded. */
  private fun sweep() {
    if (pending.size < ALPHA * 4) return
    val cutoff = System.currentTimeMillis() - QUERY_TIMEOUT_MS * 2
    val dead = pending.entries.filter { it.value.since < cutoff }
    for (entry in dead) {
      pending.remove(entry.key)?.future?.cancel(false)
    }
  }

  private fun send(bytes: ByteArray, address: InetSocketAddress): Boolean =
    runCatching { socket.send(DatagramPacket(bytes, bytes.size, address)) }.isSuccess

  private fun receiveLoop() {
    val buffer = ByteArray(4096)
    while (running) {
      try {
        val packet = DatagramPacket(buffer, buffer.size)
        socket.receive(packet)
        val message =
          Bencode.dict(Bencode.decode(buffer.copyOfRange(0, packet.length))) ?: continue
        when (Bencode.text(message["y"])) {
          "r" -> {
            val tid = message["t"] as? ByteArray ?: continue
            pending.remove(hex(tid))?.future?.complete(message)
            // A node that answers is a node worth keeping.
            Bencode.dict(message["r"])?.get("id")?.let { id ->
              (id as? ByteArray)?.takeIf { it.size == ID_BITS }?.let {
                remember(Node(it, InetSocketAddress(packet.address, packet.port)))
              }
            }
          }
          "q" -> answer(message, InetSocketAddress(packet.address, packet.port))
          // "e" is an error reply; the query just times out.
        }
      } catch (_: Exception) {
        if (!running) return
        // A malformed datagram must not take the loop down with it.
      }
    }
  }

  /**
   * Answers `ping` so the nodes this client talks to can keep it in their
   * tables. Other queries are ignored — a leaf node that stores nothing has
   * nothing truthful to say to `get_peers` or `announce_peer`.
   */
  private fun answer(message: Map<String, Any?>, from: InetSocketAddress) {
    if (Bencode.text(message["q"]) != "ping") return
    val tid = message["t"] as? ByteArray ?: return
    val reply = mapOf("t" to tid, "y" to "r", "r" to mapOf<String, Any?>("id" to nodeId))
    runCatching { Bencode.encode(reply) }.getOrNull()?.let { send(it, from) }
  }

  /* ── compact encodings ────────────────────────────────── */

  /** BEP 5 packs each node as 20 bytes of id, 4 of IPv4, 2 of port. */
  private fun compactNodes(value: Any?): List<Node> {
    val bytes = value as? ByteArray ?: return emptyList()
    val out = ArrayList<Node>(bytes.size / 26)
    var at = 0
    while (at + 26 <= bytes.size) {
      val id = bytes.copyOfRange(at, at + ID_BITS)
      val ip = bytes.copyOfRange(at + ID_BITS, at + 24)
      val port = ((bytes[at + 24].toInt() and 0xFF) shl 8) or (bytes[at + 25].toInt() and 0xFF)
      at += 26
      if (port <= 0) continue
      runCatching {
          Node(id, InetSocketAddress(InetAddress.getByAddress(ip), port))
        }
        .getOrNull()
        ?.let(out::add)
    }
    return out
  }

  /** `values` is a list of 6-byte peers, not one packed string. */
  private fun compactPeers(value: Any?): List<TorrentEngine.Peer> {
    val list = value as? List<*> ?: return emptyList()
    val out = ArrayList<TorrentEngine.Peer>()
    for (entry in list) {
      val bytes = entry as? ByteArray ?: continue
      if (bytes.size < 6) continue
      val host =
        (0 until 4).joinToString(".") { (bytes[it].toInt() and 0xFF).toString() }
      val port = ((bytes[4].toInt() and 0xFF) shl 8) or (bytes[5].toInt() and 0xFF)
      if (port > 0) out.add(TorrentEngine.Peer(host, port))
    }
    return out
  }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  override fun close() {
    running = false
    reader.interrupt()
    runCatching { socket.close() }
    pending.values.forEach { it.future.cancel(true) }
    pending.clear()
    table.clear()
  }
}
