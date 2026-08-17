package com.depot.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper

/**
 * A real Android WebView, with real `window.open` support.
 *
 * Sign-in providers hand their result back through `window.opener`, so a popup
 * has to be a genuine child of the WebView that opened it — reporting the URL
 * and loading it somewhere else silently breaks Dropbox's "Continue with
 * Google/Apple/Microsoft" buttons. `onCreateWindow` therefore builds a child
 * WebView, hands it back through the transport, and parks it over the page
 * until the site calls `window.close()`.
 *
 * This is the Android shape of the desktop's `on_new_window` handler.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class DepotWebView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

  val web = WebView(reactContext)
  private var popup: WebView? = null

  private var lastUrl: String = ""
  private var progress: Int = 0

  init {
    addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    configure(web)

    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

    web.webViewClient = client(main = true)
    web.webChromeClient = chrome(main = true)
    web.setDownloadListener(
      DownloadListener { url, _, _, _, _ ->
        // Downloads leave the page, so Android's own handler takes them.
        runCatching {
          reactContext.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        }
      },
    )
  }

  private fun configure(view: WebView) {
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      loadWithOverviewMode = true
      useWideViewPort = true
      mediaPlaybackRequiresUserGesture = false
      javaScriptCanOpenWindowsAutomatically = true
      // Required for `window.open` to reach onCreateWindow at all.
      setSupportMultipleWindows(true)
      cacheMode = WebSettings.LOAD_DEFAULT
    }
    view.isVerticalScrollBarEnabled = true
  }

  // Explicit return types: `chrome` builds child clients by calling itself, and
  // Kotlin cannot infer through that.
  private fun client(main: Boolean): WebViewClient =
    object : WebViewClient() {
      override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        if (main) {
          lastUrl = url
          emitNavigation(true)
        }
      }

      override fun onPageFinished(view: WebView, url: String) {
        if (main) {
          lastUrl = url
          emitNavigation(false)
        }
      }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        // Keep http(s) inside the tab; hand app links (intent:, mailto:, …) to Android.
        if (url.startsWith("http://") || url.startsWith("https://")) return false
        return runCatching {
            reactContext.startActivity(
              Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
          }
          .getOrDefault(true)
      }

      override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
      ) {
        if (main && request.isForMainFrame) {
          emitError(error.description?.toString() ?: "Page failed to load")
        }
      }
    }

  private fun chrome(main: Boolean): WebChromeClient =
    object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        if (main) {
          progress = newProgress
          emitNavigation(newProgress < 100)
        }
      }

      override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean {
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        val child = WebView(reactContext)
        configure(child)
        child.webViewClient = client(main = false)
        child.webChromeClient = chrome(main = false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(child, true)

        closePopup()
        popup = child
        addView(child, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        transport.webView = child
        resultMsg.sendToTarget()
        emitPopup(true)
        return true
      }

      override fun onCloseWindow(window: WebView) {
        if (window === popup) {
          closePopup()
        }
      }
    }

  /** Dismisses the sign-in popup — from `window.close()` or the app's own control. */
  fun closePopup() {
    val child = popup ?: return
    popup = null
    (child.parent as? ViewGroup)?.removeView(child)
    child.stopLoading()
    child.webChromeClient = null
    child.destroy()
    emitPopup(false)
  }

  fun hasPopup() = popup != null

  fun load(url: String) {
    if (url.isEmpty() || url == lastUrl) return
    lastUrl = url
    web.loadUrl(url)
  }

  fun destroyAll() {
    closePopup()
    web.stopLoading()
    web.loadUrl("about:blank")
    web.destroy()
  }

  private fun emitNavigation(loading: Boolean) {
    dispatch(
      "topNavigation",
      Arguments.createMap().apply {
        putString("url", lastUrl)
        putString("title", web.title ?: "")
        putBoolean("loading", loading)
        putBoolean("canGoBack", web.canGoBack())
        putBoolean("canGoForward", web.canGoForward())
        putInt("progress", progress)
      },
    )
  }

  private fun emitPopup(open: Boolean) {
    dispatch("topPopup", Arguments.createMap().apply { putBoolean("open", open) })
  }

  private fun emitError(message: String) {
    dispatch("topWebError", Arguments.createMap().apply { putString("message", message) })
  }

  private fun dispatch(name: String, payload: WritableMap) {
    val surfaceId = UIManagerHelper.getSurfaceId(this)
    UIManagerHelper.getEventDispatcherForReactTag(reactContext as ReactContext, id)
      ?.dispatchEvent(DepotEvent(surfaceId, id, name, payload))
  }
}
