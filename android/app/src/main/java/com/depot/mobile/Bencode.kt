package com.depot.mobile

import java.io.ByteArrayOutputStream

/**
 * Bencode reader/writer. Byte strings stay as `ByteArray` because info-hashes
 * are computed over the exact bytes a torrent shipped with — decoding them as
 * text and re-encoding would change the hash.
 */
object Bencode {

  class Cursor(val bytes: ByteArray, var at: Int = 0)

  fun decode(bytes: ByteArray): Any? = decode(Cursor(bytes))

  fun decode(c: Cursor): Any? {
    if (c.at >= c.bytes.size) return null
    return when (val marker = c.bytes[c.at].toInt().toChar()) {
      'i' -> {
        c.at++
        val end = indexOf(c, 'e')
        val value = String(c.bytes, c.at, end - c.at).toLong()
        c.at = end + 1
        value
      }
      'l' -> {
        c.at++
        val out = ArrayList<Any?>()
        while (c.at < c.bytes.size && c.bytes[c.at].toInt().toChar() != 'e') out.add(decode(c))
        c.at++
        out
      }
      'd' -> {
        c.at++
        val out = LinkedHashMap<String, Any?>()
        while (c.at < c.bytes.size && c.bytes[c.at].toInt().toChar() != 'e') {
          val key = decode(c) as? ByteArray ?: break
          out[String(key, Charsets.UTF_8)] = decode(c)
        }
        c.at++
        out
      }
      in '0'..'9' -> {
        val colon = indexOf(c, ':')
        val length = String(c.bytes, c.at, colon - c.at).toInt()
        val start = colon + 1
        c.at = start + length
        c.bytes.copyOfRange(start, minOf(start + length, c.bytes.size))
      }
      else -> throw IllegalArgumentException("Bad bencode at ${c.at}: $marker")
    }
  }

  /** Byte range of a top-level dictionary member, so `info` can be hashed verbatim. */
  fun sliceOf(bytes: ByteArray, key: String): ByteArray? {
    val c = Cursor(bytes)
    if (c.bytes.getOrNull(0)?.toInt()?.toChar() != 'd') return null
    c.at++
    while (c.at < c.bytes.size && c.bytes[c.at].toInt().toChar() != 'e') {
      val name = decode(c) as? ByteArray ?: return null
      val start = c.at
      decode(c)
      if (String(name, Charsets.UTF_8) == key) return bytes.copyOfRange(start, c.at)
    }
    return null
  }

  fun encode(value: Any?): ByteArray {
    val out = ByteArrayOutputStream()
    write(out, value)
    return out.toByteArray()
  }

  private fun write(out: ByteArrayOutputStream, value: Any?) {
    when (value) {
      is Long -> out.write("i${value}e".toByteArray())
      is Int -> out.write("i${value}e".toByteArray())
      is ByteArray -> {
        out.write("${value.size}:".toByteArray())
        out.write(value)
      }
      is String -> write(out, value.toByteArray())
      is List<*> -> {
        out.write('l'.code)
        value.forEach { write(out, it) }
        out.write('e'.code)
      }
      is Map<*, *> -> {
        out.write('d'.code)
        value.entries
          .sortedBy { it.key.toString() }
          .forEach {
            write(out, it.key.toString())
            write(out, it.value)
          }
        out.write('e'.code)
      }
      else -> throw IllegalArgumentException("Cannot bencode ${value?.javaClass}")
    }
  }

  private fun indexOf(c: Cursor, target: Char): Int {
    var i = c.at
    while (i < c.bytes.size && c.bytes[i].toInt().toChar() != target) i++
    if (i >= c.bytes.size) throw IllegalArgumentException("Unterminated bencode value")
    return i
  }

  @Suppress("UNCHECKED_CAST")
  fun dict(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

  fun text(value: Any?): String? = (value as? ByteArray)?.toString(Charsets.UTF_8)

  fun number(value: Any?): Long? = value as? Long
}
