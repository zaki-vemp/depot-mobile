package com.depot.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.io.InputStream
import java.util.zip.ZipFile

/**
 * Reads enough of an Office file to show it, without a document library: OOXML
 * parts are plain XML inside a zip. Mirrors what `office.rs` returns on the
 * desktop so the same view renders both.
 */
object OfficeReader {

  private const val MAX_ROWS = 300
  private const val MAX_COLS = 40
  private const val MAX_BLOCKS = 400

  fun preview(path: String): JSONObject {
    val file = File(path)
    if (!file.isFile) throw IllegalArgumentException("File does not exist")
    return when (file.extension.lowercase()) {
      "csv" -> separated(file, ',')
      "tsv" -> separated(file, '\t')
      "xlsx", "xlsm", "xlsb" -> xlsx(file)
      "docx" -> docx(file)
      "pptx" -> pptx(file)
      else ->
        throw IllegalArgumentException(
          "Depot reads xlsx, docx, pptx, csv and tsv directly — open this one with another app.",
        )
    }
  }

  /* ── plain separated values ───────────────────────────── */

  private fun separated(file: File, sep: Char): JSONObject {
    val rows = JSONArray()
    var truncated = false
    file.bufferedReader().useLines { lines ->
      for ((i, line) in lines.withIndex()) {
        if (i >= MAX_ROWS) {
          truncated = true
          return@useLines
        }
        rows.put(JSONArray(splitDelimited(line, sep).take(MAX_COLS)))
      }
    }
    return result(
      kind = "spreadsheet",
      sheets = JSONArray().put(sheet(file.name, rows)),
      pages = JSONArray(),
      truncated = truncated,
      note = "Plain text table",
    )
  }

  /** Handles quoted fields so a comma inside "a,b" stays one cell. */
  private fun splitDelimited(line: String, sep: Char): List<String> {
    val out = ArrayList<String>()
    val cell = StringBuilder()
    var quoted = false
    var i = 0
    while (i < line.length) {
      val c = line[i]
      when {
        quoted && c == '"' && i + 1 < line.length && line[i + 1] == '"' -> {
          cell.append('"')
          i++
        }
        c == '"' -> quoted = !quoted
        c == sep && !quoted -> {
          out.add(cell.toString())
          cell.setLength(0)
        }
        else -> cell.append(c)
      }
      i++
    }
    out.add(cell.toString())
    return out
  }

  /* ── xlsx ─────────────────────────────────────────────── */

  private fun xlsx(file: File): JSONObject {
    ZipFile(file).use { zip ->
      val shared = zip.getEntry("xl/sharedStrings.xml")?.let { zip.getInputStream(it).use(::sharedStrings) }
        ?: emptyList()
      val names = zip.getEntry("xl/workbook.xml")?.let { zip.getInputStream(it).use(::sheetNames) }
        ?: emptyList()

      val sheetEntries =
        zip.entries()
          .toList()
          .filter { it.name.startsWith("xl/worksheets/sheet") && it.name.endsWith(".xml") }
          .sortedBy { it.name.filter(Char::isDigit).toIntOrNull() ?: 0 }

      if (sheetEntries.isEmpty()) throw IllegalArgumentException("No worksheets in this workbook")

      val sheets = JSONArray()
      var truncated = false
      for ((index, entry) in sheetEntries.withIndex()) {
        val parsed = zip.getInputStream(entry).use { worksheet(it, shared) }
        truncated = truncated || parsed.second
        sheets.put(sheet(names.getOrNull(index) ?: "Sheet ${index + 1}", parsed.first))
      }
      return result("spreadsheet", sheets, JSONArray(), truncated, "Values only — formulas and formatting are not rendered")
    }
  }

  private fun sharedStrings(input: InputStream): List<String> {
    val out = ArrayList<String>()
    val parser = newParser(input)
    var text: StringBuilder? = null
    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      when (parser.eventType) {
        XmlPullParser.START_TAG -> if (parser.name == "si") text = StringBuilder()
        XmlPullParser.TEXT -> if (text != null && !parser.isWhitespace) text.append(parser.text)
        XmlPullParser.END_TAG ->
          if (parser.name == "si") {
            out.add(text?.toString().orEmpty())
            text = null
          }
      }
    }
    return out
  }

  private fun sheetNames(input: InputStream): List<String> {
    val out = ArrayList<String>()
    val parser = newParser(input)
    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      if (parser.eventType == XmlPullParser.START_TAG && parser.name == "sheet") {
        out.add(parser.getAttributeValue(null, "name") ?: "Sheet ${out.size + 1}")
      }
    }
    return out
  }

  /** Returns the grid plus whether it was cut short. */
  private fun worksheet(input: InputStream, shared: List<String>): Pair<JSONArray, Boolean> {
    val rows = JSONArray()
    val parser = newParser(input)
    var row: Array<String>? = null
    var column = 0
    var cellType: String? = null
    var value: StringBuilder? = null
    var truncated = false

    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      when (parser.eventType) {
        XmlPullParser.START_TAG ->
          when (parser.name) {
            "row" -> row = Array(MAX_COLS) { "" }
            "c" -> {
              column = columnIndex(parser.getAttributeValue(null, "r"))
              cellType = parser.getAttributeValue(null, "t")
            }
            "v", "t" -> value = StringBuilder()
          }
        XmlPullParser.TEXT -> value?.append(parser.text)
        XmlPullParser.END_TAG ->
          when (parser.name) {
            "v", "t" -> {
              val raw = value?.toString().orEmpty()
              value = null
              val text = if (cellType == "s") shared.getOrNull(raw.toIntOrNull() ?: -1).orEmpty() else raw
              if (row != null && column in 0 until MAX_COLS && text.isNotEmpty()) row[column] = text
            }
            "row" -> {
              val current = row
              row = null
              if (current != null) {
                if (rows.length() >= MAX_ROWS) {
                  truncated = true
                } else {
                  val used = current.indexOfLast { it.isNotEmpty() } + 1
                  rows.put(JSONArray(current.take(maxOf(used, 1))))
                }
              }
            }
          }
      }
    }
    return rows to truncated
  }

  /** `BC12` → 54. Spreadsheet columns are base-26 letters. */
  private fun columnIndex(ref: String?): Int {
    if (ref.isNullOrEmpty()) return 0
    var n = 0
    for (c in ref) {
      if (!c.isLetter()) break
      n = n * 26 + (c.uppercaseChar() - 'A' + 1)
    }
    return n - 1
  }

  /* ── docx ─────────────────────────────────────────────── */

  private fun docx(file: File): JSONObject {
    ZipFile(file).use { zip ->
      val entry =
        zip.getEntry("word/document.xml")
          ?: throw IllegalArgumentException("No document part in this file")
      val paragraphs = ArrayList<String>()
      zip.getInputStream(entry).use { input ->
        val p = newParser(input)
        var paragraph: StringBuilder? = null
        var run: StringBuilder? = null
        while (p.next() != XmlPullParser.END_DOCUMENT) {
          when (p.eventType) {
            XmlPullParser.START_TAG ->
              when (p.name) {
                "p" -> paragraph = StringBuilder()
                "t" -> run = StringBuilder()
                "br", "tab" -> paragraph?.append(if (p.name == "tab") "\t" else "\n")
              }
            XmlPullParser.TEXT -> run?.append(p.text)
            XmlPullParser.END_TAG ->
              when (p.name) {
                "t" -> {
                  paragraph?.append(run?.toString().orEmpty())
                  run = null
                }
                "p" -> {
                  paragraphs.add(paragraph?.toString().orEmpty())
                  paragraph = null
                }
              }
          }
        }
      }

      val trimmed = paragraphs.filter { it.isNotBlank() }
      val truncated = trimmed.size > MAX_BLOCKS
      val pages = JSONArray()
      pages.put(
        JSONObject()
          .put("title", file.nameWithoutExtension)
          .put("body", trimmed.take(MAX_BLOCKS).joinToString("\n\n")),
      )
      return result("document", JSONArray(), pages, truncated, "Text only — images and styling are not rendered")
    }
  }

  /* ── pptx ─────────────────────────────────────────────── */

  private fun pptx(file: File): JSONObject {
    ZipFile(file).use { zip ->
      val slides =
        zip.entries()
          .toList()
          .filter { it.name.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
          .sortedBy { it.name.filter(Char::isDigit).toIntOrNull() ?: 0 }

      if (slides.isEmpty()) throw IllegalArgumentException("No slides in this deck")

      val pages = JSONArray()
      for ((index, entry) in slides.withIndex()) {
        val lines = zip.getInputStream(entry).use(::slideText)
        pages.put(
          JSONObject()
            .put("title", lines.firstOrNull()?.take(80) ?: "Slide ${index + 1}")
            .put("body", lines.drop(1).joinToString("\n")),
        )
      }
      return result("slides", JSONArray(), pages, slides.size > MAX_BLOCKS, "Slide text in order")
    }
  }

  private fun slideText(input: InputStream): List<String> {
    val out = ArrayList<String>()
    val parser = newParser(input)
    var run: StringBuilder? = null
    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      when (parser.eventType) {
        XmlPullParser.START_TAG -> if (parser.name == "t") run = StringBuilder()
        XmlPullParser.TEXT -> run?.append(parser.text)
        XmlPullParser.END_TAG ->
          if (parser.name == "t") {
            run?.toString()?.takeIf { it.isNotBlank() }?.let(out::add)
            run = null
          }
      }
    }
    return out
  }

  /* ── helpers ──────────────────────────────────────────── */

  private fun newParser(input: InputStream): XmlPullParser {
    val factory = XmlPullParserFactory.newInstance()
    factory.isNamespaceAware = false
    return factory.newPullParser().apply { setInput(input, null) }
  }

  private fun sheet(name: String, rows: JSONArray) =
    JSONObject().put("name", name).put("rows", rows)

  private fun result(
    kind: String,
    sheets: JSONArray,
    pages: JSONArray,
    truncated: Boolean,
    note: String,
  ) =
    JSONObject()
      .put("kind", kind)
      .put("sheets", sheets)
      .put("pages", pages)
      .put("truncated", truncated)
      .put("note", if (truncated) "$note · shown in part" else note)
}
