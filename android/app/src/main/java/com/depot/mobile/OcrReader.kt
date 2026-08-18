package com.depot.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Reading the text out of a picture, on device.
 *
 * A file manager holds a lot of text that is only pixels — receipts, whiteboard
 * photos, screenshots of error messages — and the useful move is almost always
 * to get that text back out as something selectable. ML Kit's bundled Latin
 * model does the recognition offline; nothing about the image leaves the phone.
 *
 * Blocks come back with their boxes as well as the joined text, so the viewer
 * can highlight regions later without a second pass over the image.
 */
object OcrReader {

  /** Big camera photos are downscaled first; the model gains nothing past this. */
  private const val MAX_EDGE = 2560
  private const val TIMEOUT_SECONDS = 45L

  fun read(ctx: Context, path: String): JSONObject {
    val file = File(path)
    if (!file.isFile) throw IllegalArgumentException("That image is not on disk any more")

    val bitmap = decodeBounded(file) ?: throw IllegalArgumentException("That file is not an image")
    return try {
      val image = InputImage.fromBitmap(bitmap, rotationOf(file))
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        val result =
          Tasks.await(recognizer.process(image), TIMEOUT_SECONDS, TimeUnit.SECONDS)
        val blocks = JSONArray()
        for (block in result.textBlocks) {
          val box = block.boundingBox
          blocks.put(
            JSONObject()
              .put("text", block.text)
              .put("x", box?.left ?: 0)
              .put("y", box?.top ?: 0)
              .put("width", box?.width() ?: 0)
              .put("height", box?.height() ?: 0),
          )
        }
        JSONObject()
          .put("text", result.text)
          .put("blocks", blocks)
          .put("width", bitmap.width)
          .put("height", bitmap.height)
      } finally {
        recognizer.close()
      }
    } finally {
      bitmap.recycle()
    }
  }

  /** Decodes at a sample size that keeps a 48MP photo from exhausting the heap. */
  private fun decodeBounded(file: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (
      bounds.outWidth / sample > MAX_EDGE || bounds.outHeight / sample > MAX_EDGE
    ) {
      sample *= 2
    }
    return BitmapFactory.decodeFile(
      file.absolutePath,
      BitmapFactory.Options().apply { inSampleSize = sample },
    )
  }

  /**
   * A photo taken sideways is stored upright with an orientation tag, and the
   * model reads rotated text badly, so the tag is passed through rather than
   * dropped by the manual decode above.
   */
  private fun rotationOf(file: File): Int =
    runCatching {
        when (
          ExifInterface(file.absolutePath)
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        ) {
          ExifInterface.ORIENTATION_ROTATE_90 -> 90
          ExifInterface.ORIENTATION_ROTATE_180 -> 180
          ExifInterface.ORIENTATION_ROTATE_270 -> 270
          else -> 0
        }
      }
      .getOrDefault(0)
}
