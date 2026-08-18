package com.depot.mobile

import android.app.Activity
import android.content.Intent
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * The app's only `startActivityForResult` path.
 *
 * Everything else in Depot fires intents at the application context and never
 * looks back, which is fine for "open with" and share. The WebView's file
 * chooser cannot work that way: `onShowFileChooser` hands out a callback that
 * *must* be answered, and leaving it unanswered wedges the page's picker until
 * the tab is destroyed. So requests are parked here by request code and
 * completed from [DepotModule]'s activity-result listener.
 */
object ActivityResults {

  private val next = AtomicInteger(9100)
  private val waiting = ConcurrentHashMap<Int, (Int, Intent?) -> Unit>()

  /**
   * Launches [intent] and calls [onResult] with the result code and data.
   * Returns false when there is no foreground activity to launch from, in which
   * case [onResult] is never called and the caller must clean up itself.
   */
  fun launch(activity: Activity?, intent: Intent, onResult: (Int, Intent?) -> Unit): Boolean {
    val host = activity ?: return false
    val code = next.incrementAndGet() and 0xffff
    waiting[code] = onResult
    return runCatching { host.startActivityForResult(intent, code) }
      .map { true }
      .getOrElse {
        waiting.remove(code)
        false
      }
  }

  fun deliver(requestCode: Int, resultCode: Int, data: Intent?) {
    waiting.remove(requestCode)?.invoke(resultCode, data)
  }

  /** Drops anything still parked; the callbacks are answered by their owners. */
  fun clear() = waiting.clear()
}
